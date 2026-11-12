#!/usr/bin/env python3
"""gen-audio.py - make the game's sound effects and music with ElevenLabs.

Reads audio/sounds.json and, for each entry:
  1. skips it if public/audio/<id>.mp3 exists and was made from the SAME prompt and
     settings (the fingerprint in audio/generated.json) -> re-runs cost nothing;
  2. otherwise asks ElevenLabs (sound effects: /v1/sound-generation,
     music: /v1/music) and saves the raw file under audio/raw/<id>.mp3;
     ("supplied" entries are files we already own, e.g. from the Beyond Extinction
      Godot repo: no API call, no credits, they're just trimmed);
  3. evens out the loudness and encodes it small for the web with ffmpeg
     (sound effects: mono 64 kbps, music: stereo 112 kbps) into public/audio/<id>.mp3;
  4. writes public/audio/manifest.json: which sounds exist + a version for each, so
     the game knows what it can play (anything missing falls back to the old beeps).

The ElevenLabs API key is a SECRET. It is read from the ELEVENLABS_API_KEY
environment variable only (the GitHub Action passes the repository secret in),
and it is never printed, logged or written to any file.

Usage:
  python3 scripts/gen-audio.py --dry-run              # list what would be made, spend nothing
  python3 scripts/gen-audio.py                        # make everything missing / changed
  python3 scripts/gen-audio.py --kind sfx             # only sound effects (or: music)
  python3 scripts/gen-audio.py --only roar,levelUp    # only these ids
  python3 scripts/gen-audio.py --force --only roar    # make it again even if it exists
  python3 scripts/gen-audio.py --manifest-only        # just rebuild manifest.json
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, "audio", "sounds.json")
RECORD = os.path.join(ROOT, "audio", "generated.json")   # fingerprints of what was made
RAW = os.path.join(ROOT, "audio", "raw")                 # untouched ElevenLabs files
OUT = os.path.join(ROOT, "public", "audio")              # what the game loads
KEY_ENV = "ELEVENLABS_API_KEY"

SFX_API = "https://api.elevenlabs.io/v1/sound-generation"
MUSIC_API = "https://api.elevenlabs.io/v1/music"
MUSIC_MODEL = "music_v2"          # music_v1 is deprecated (removed Jan 2027)
RETRYABLE = {408, 425, 429, 500, 502, 503, 504}


def api_key():
    key = os.environ.get(KEY_ENV, "").strip()
    if not key:
        sys.exit("%s is not set. Run this from the 'Generate audio' GitHub Action (it passes the "
                 "repository secret in), or export it in your shell. Never put it in a file." % KEY_ENV)
    return key


def fingerprint(kind, entry):
    """Everything that changes the sound. Same fingerprint = no need to pay again."""
    if kind == "sfx":
        parts = ["sfx", entry["prompt"], str(entry.get("duration")), str(entry.get("influence", 0.4)), str(entry.get("loop", False))]
    else:
        parts = ["music", MUSIC_MODEL, entry["prompt"], str(entry.get("seconds"))]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()[:16]


def why(exc):
    """What ElevenLabs said (never contains the key; redacted anyway, just in case)."""
    try:
        body = exc.read().decode("utf-8", "replace")[:500]
    except Exception:  # noqa: BLE001 - diagnostics only
        return ""
    key = os.environ.get(KEY_ENV)
    return body.replace(key, "<the key>") if key else body


def request(kind, entry):
    if kind == "sfx":
        url = SFX_API + "?output_format=mp3_44100_128"
        body = {"text": entry["prompt"], "prompt_influence": entry.get("influence", 0.4)}
        if entry.get("duration") is not None:
            body["duration_seconds"] = entry["duration"]
        if entry.get("loop"):
            body["loop"] = True
    else:
        url = MUSIC_API + "?output_format=mp3_44100_128"
        body = {"prompt": entry["prompt"], "music_length_ms": int(entry["seconds"] * 1000),
                "model_id": MUSIC_MODEL, "force_instrumental": True}
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "audio/mpeg")
    req.add_header("xi-api-key", api_key())  # never logged
    with urllib.request.urlopen(req, timeout=300 if kind == "music" else 120) as resp:
        data = resp.read()
    if not data:
        raise RuntimeError("empty audio response")
    return data


def generate(kind, entry):
    """Ask ElevenLabs (with retries for temporary errors). Returns the mp3 bytes."""
    last = None
    for attempt in range(1, 5):
        try:
            return request(kind, entry)
        except urllib.error.HTTPError as exc:
            last = exc
            said = why(exc)
            if exc.code in (401, 403):
                raise RuntimeError("ElevenLabs refused the key (HTTP %d): %s. Check the %s secret, "
                                   "or the account's credits." % (exc.code, said, KEY_ENV))
            if exc.code in (400, 422):
                raise RuntimeError("ElevenLabs rejected the request (HTTP %d): %s. Usually the prompt "
                                   "is too long or the duration is out of range." % (exc.code, said))
            if exc.code not in RETRYABLE:
                raise RuntimeError("HTTP %d: %s" % (exc.code, said))
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        time.sleep(2 * attempt)
    raise RuntimeError("gave up after 4 tries: %s" % last)


def encode(kind, src, dst, trim=None):
    """Even loudness + small web mp3. Music/ambience quieter than effects so they sit under them.
    `trim` = [start, length] in seconds (supplied files), with a short fade out at the cut."""
    loud = {"sfx": "loudnorm=I=-16:TP=-1.5:LRA=11", "music": "loudnorm=I=-19:TP=-1.5:LRA=11",
            "ambience": "loudnorm=I=-24:TP=-2:LRA=11"}[kind]
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    af = loud
    if trim:
        args += ["-ss", str(trim[0]), "-t", str(trim[1])]
        af = "afade=t=out:st=%s:d=0.15,%s" % (max(0, trim[1] - 0.15), loud)
    args += ["-i", src, "-af", af, "-ar", "44100"]
    args += ["-ac", "1", "-b:a", "64k"] if kind == "sfx" else ["-ac", "2", "-b:a", "112k" if kind == "music" else "80k"]
    subprocess.run(args + [dst], check=True)


def supplied(entry):
    """A file we already own: trim + level + compress it (no API, no credits)."""
    src = os.path.join(ROOT, entry["file"])
    with open(src, "rb") as f:
        fp = hashlib.sha256(f.read() + json.dumps(entry.get("trim")).encode()).hexdigest()[:16]
    return src, fp


def write_manifest(record):
    """public/audio/manifest.json = { id: version } for every file that exists."""
    have = {}
    for sid, info in sorted(record.items()):
        if os.path.exists(os.path.join(OUT, sid + ".mp3")):
            have[sid] = info["fp"][:8]
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(have, f, indent=1, sort_keys=True)
        f.write("\n")
    return have


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", choices=["sfx", "music", "both"], default="both")
    ap.add_argument("--only", default="", help="comma-separated ids (blank = all)")
    ap.add_argument("--force", action="store_true", help="make them again even if they exist")
    ap.add_argument("--dry-run", action="store_true", help="list what would be made; spend nothing")
    ap.add_argument("--manifest-only", action="store_true")
    a = ap.parse_args()

    spec = json.load(open(LIST))
    record = json.load(open(RECORD)) if os.path.exists(RECORD) else {}
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    if a.manifest_only:
        print("manifest:", len(write_manifest(record)), "sounds")
        return 0

    only = {s.strip() for s in a.only.split(",") if s.strip()}

    # Supplied files first: free, so always brought up to date (unless --only skips them)
    for entry in spec.get("supplied", []):
        sid = entry["id"]
        if only and sid not in only:
            continue
        src, fp = supplied(entry)
        out = os.path.join(OUT, sid + ".mp3")
        if os.path.exists(out) and record.get(sid, {}).get("fp") == fp and not a.force:
            continue
        if a.dry_run:
            print("  (free) would encode supplied %s from %s" % (sid, entry["file"]))
            continue
        encode(entry["kind"], src, out, entry.get("trim"))
        record[sid] = {"fp": fp, "kind": entry["kind"], "from": entry.get("from", entry["file"])}
        with open(RECORD, "w") as f:
            json.dump(record, f, indent=1, sort_keys=True)
            f.write("\n")
        print("  ok   %s (supplied, %d KB)" % (sid, os.path.getsize(out) // 1024))

    todo = []
    for kind in (["sfx", "music"] if a.kind == "both" else [a.kind]):
        for entry in spec[kind]:
            sid = entry["id"]
            if only and sid not in only:
                continue
            fp = fingerprint(kind, entry)
            have = os.path.exists(os.path.join(OUT, sid + ".mp3")) and record.get(sid, {}).get("fp") == fp
            if have and not a.force:
                continue
            if len(entry["prompt"]) > 400:
                print("!! %s: prompt is %d characters (keep it under ~380 or ElevenLabs rejects it)" % (sid, len(entry["prompt"])))
            todo.append((kind, entry, fp))

    secs = sum(e.get("duration", 0) for k, e, _ in todo if k == "sfx")
    mins = sum(e.get("seconds", 0) for k, e, _ in todo if k == "music") / 60
    print("To make: %d sound effects (%.1f s total), %d music tracks (%.1f min total)"
          % (sum(1 for k, *_ in todo if k == "sfx"), secs, sum(1 for k, *_ in todo if k == "music"), mins))
    for kind, entry, _ in todo:
        print("  %-6s %-14s %s" % (kind, entry["id"], entry["prompt"][:90] + ("…" if len(entry["prompt"]) > 90 else "")))
    if a.dry_run or not todo:
        write_manifest(record)
        return 0

    api_key()  # fail fast, before anything, if the secret is missing
    failed = []
    for kind, entry, fp in todo:
        sid = entry["id"]
        try:
            data = generate(kind, entry)
            raw = os.path.join(RAW, sid + ".mp3")
            with open(raw, "wb") as f:
                f.write(data)
            encode(kind, raw, os.path.join(OUT, sid + ".mp3"))
            record[sid] = {"fp": fp, "kind": kind, "made": time.strftime("%Y-%m-%d")}
            # Save the record after EVERY sound, so a later failure never loses one already paid for
            with open(RECORD, "w") as f:
                json.dump(record, f, indent=1, sort_keys=True)
                f.write("\n")
            print("  ok   %s (%d KB)" % (sid, os.path.getsize(os.path.join(OUT, sid + ".mp3")) // 1024))
        except Exception as exc:  # noqa: BLE001 - keep going: the others may be fine
            failed.append(sid)
            print("  FAIL %s: %s" % (sid, exc))
    have = write_manifest(record)
    print("Done: %d made, %d failed, %d sounds available in the game." % (len(todo) - len(failed), len(failed), len(have)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

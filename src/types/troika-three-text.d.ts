// Minimal typings for troika-three-text (it ships none). Only what we use.
declare module 'troika-three-text' {
  import * as THREE from 'three';
  export class Text extends THREE.Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: THREE.ColorRepresentation;
    anchorX: number | 'left' | 'center' | 'right';
    anchorY: number | 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom';
    textAlign: 'left' | 'right' | 'center' | 'justify';
    maxWidth: number;
    letterSpacing: number;
    outlineWidth: number | string;
    outlineColor: THREE.ColorRepresentation;
    outlineOpacity: number;
    outlineBlur: number | string;
    depthOffset: number;
    sdfGlyphSize: number;
    textRenderInfo: { blockBounds: [number, number, number, number] } | null;
    sync(callback?: () => void): void;
    dispose(): void;
  }
  export function preloadFont(opts: { font?: string; characters?: string | string[] }, callback: () => void): void;
}

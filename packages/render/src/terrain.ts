import type { Theme } from '@railprint/style';
import { viewRadius } from './chunks.ts';
import { createProjection, type View } from './projection.ts';
import {
  tileBounds,
  tileKey,
  tileLevelFor,
  tilesInBox,
  type TileIndex,
} from './tiles.ts';

/**
 * Terrain layer drawn with WebGL from the terrain tiles. Each tile is a grid
 * mesh projected in the vertex shader with the orthographic projection d3
 * uses (see projectPoint), so the layer lines up with the Canvas 2D layers
 * drawn through d3; the fragment shader only colours the tile's texels.
 */

const DEG = Math.PI / 180;

/**
 * Screen point (CSS pixels) to [lon, lat] in degrees, or undefined outside
 * the projection. The CPU twin of the shader, used for tests and exports.
 */
export function invertPoint(
  view: View,
  width: number,
  height: number,
  sx: number,
  sy: number,
): [number, number] | undefined {
  const projection = createProjection(view, width, height);
  const k = projection.scale();
  const [tx, ty] = projection.translate();
  const x = (sx - tx) / k;
  const y = (ty - sy) / k;
  const z = Math.hypot(x, y);
  if (z > 1) return undefined;
  const c = Math.asin(z);
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  const lambda = Math.atan2(x * sc, z * cc);
  const phi = Math.asin(z ? (y * sc) / z : 0);
  // Undo the rotation [-lon0, -lat0].
  const dPhi = -view.center[1] * DEG;
  const cosPhi = Math.cos(phi);
  const px = Math.cos(lambda) * cosPhi;
  const py = Math.sin(lambda) * cosPhi;
  const pz = Math.sin(phi);
  const lon =
    Math.atan2(py, px * Math.cos(dPhi) + pz * Math.sin(dPhi)) / DEG +
    view.center[0];
  const lat =
    Math.asin(
      Math.max(-1, Math.min(1, pz * Math.cos(dPhi) - px * Math.sin(dPhi))),
    ) / DEG;
  return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
}

/**
 * [lon, lat] to the screen (CSS pixels) as d3's orthographic projection of
 * `view` does, and whether the point faces the viewer. The CPU twin of the
 * tile vertex shader.
 */
export function projectPoint(
  view: View,
  width: number,
  height: number,
  [lon, lat]: [number, number],
): { x: number; y: number; facing: boolean } {
  const k = view.pixelsPerDegree / DEG;
  const lambda = (lon - view.center[0]) * DEG;
  const phi = lat * DEG;
  const phi0 = view.center[1] * DEG;
  const x = Math.cos(phi) * Math.cos(lambda);
  const y = Math.cos(phi) * Math.sin(lambda);
  const z = Math.sin(phi);
  const xr = x * Math.cos(phi0) + z * Math.sin(phi0);
  const zr = z * Math.cos(phi0) - x * Math.sin(phi0);
  return { x: width / 2 + k * y, y: height / 2 - k * zr, facing: xr > 0 };
}

/** Quads along each side of a tile's mesh. */
const GRID = 16;

const TILE_VERTEX = `#version 300 es
in vec2 a_uv;                 // position within the tile, 0–1 from its north-west corner
uniform vec4 u_box;           // west, south, east, north (degrees)
uniform vec2 u_size;          // CSS pixels
uniform float u_k;            // d3 scale
uniform vec2 u_center;        // globe centre, radians
out vec2 v_uv;
out float v_facing;

const float DEG = 3.141592653589793 / 180.0;

void main() {
  float lambda = (mix(u_box.x, u_box.z, a_uv.x) * DEG) - u_center.x;
  float phi = mix(u_box.w, u_box.y, a_uv.y) * DEG;
  vec3 p = vec3(cos(phi) * cos(lambda), cos(phi) * sin(lambda), sin(phi));
  float xr = p.x * cos(u_center.y) + p.z * sin(u_center.y);
  float zr = p.z * cos(u_center.y) - p.x * sin(u_center.y);
  vec2 s = u_size * 0.5 + u_k * vec2(p.y, -zr);
  gl_Position = vec4(s.x / u_size.x * 2.0 - 1.0, 1.0 - s.y / u_size.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
  v_facing = xr;
}`;

const TILE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_facing;
out vec4 outColor;

uniform sampler2D u_tile;
uniform vec3 u_seaColor;
uniform vec3 u_landLow;
uniform vec3 u_landHigh;
uniform float u_shade;
uniform float u_flatShade;

void main() {
  if (v_facing < 0.0) discard;   // the far side of the globe
  vec3 t = texture(u_tile, v_uv).rgb;
  float relief = t.r / u_flatShade;            // 1 on flat ground and sea
  float elevation = t.g * t.g;                 // undo the sqrt encoding
  float land = t.b;
  vec3 ground = mix(u_landLow, u_landHigh, smoothstep(0.0, 0.7, elevation));
  ground *= mix(1.0, relief, u_shade);
  outColor = vec4(mix(u_seaColor, ground, land), 1.0);
}`;

/** Open sea: the globe's disc in one colour. */
const SEA_VERTEX = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

const SEA_FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 u_size;          // CSS pixels
uniform float u_ratio;
uniform float u_k;
uniform vec3 u_seaColor;
void main() {
  vec2 s = vec2(gl_FragCoord.x, u_size.y * u_ratio - gl_FragCoord.y) / u_ratio;
  if (length(s - u_size * 0.5) > u_k) discard;
  outColor = vec4(u_seaColor, 1.0);
}`;

function hex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`Expected #rrggbb, got ${color}`);
  return [
    parseInt(m[1]!, 16) / 255,
    parseInt(m[2]!, 16) / 255,
    parseInt(m[3]!, 16) / 255,
  ];
}

function program(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(
        `Terrain shader: ${gl.getShaderInfoLog(shader) ?? 'compile failed'}`,
      );
    return shader;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(
      `Terrain program: ${gl.getProgramInfoLog(p) ?? 'link failed'}`,
    );
  return p;
}

type Box = [number, number, number, number];

/**
 * [west, south, east, north] around what the view shows; west exceeds east
 * across the antimeridian.
 */
export function viewBox(view: View, width: number, height: number): Box {
  const r = viewRadius(view, width, height) / DEG;
  const [lon, lat] = view.center;
  const south = Math.max(-90, lat - r);
  const north = Math.min(90, lat + r);
  const cosLat = Math.cos(lat * DEG);
  const sinR = Math.sin(r * DEG);
  if (north >= 90 || south <= -90 || sinR >= cosLat)
    return [-180, south, 180, north];
  const half = Math.asin(sinR / cosLat) / DEG;
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return [wrap(lon - half), south, wrap(lon + half), north];
}

interface Tile {
  key: string;
  level: number;
  box: Box;
  /** Level 0 stays loaded, so the globe always shows terrain. */
  pinned?: boolean;
  texture?: WebGLTexture;
  state: 'loading' | 'ready' | 'failed';
  used: number;
}

/** Textures kept on the GPU; older unused ones are deleted. */
const MAX_TEXTURES = 160;
/** Tiles downloading at once. */
const MAX_LOADING = 8;

export interface TerrainOptions {
  /** Base URL of the tiles, ending in `/`. */
  url: string;
  index: TileIndex;
  /** Called when a tile arrives, so the caller can draw again. */
  onTile: () => void;
}

/** Draws the terrain tiles into a WebGL2 canvas, loading them as needed. */
export class TerrainRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly tileProgram: WebGLProgram;
  private readonly seaProgram: WebGLProgram;
  private readonly tileMesh: WebGLVertexArrayObject;
  private readonly seaMesh: WebGLVertexArrayObject;
  private readonly indexCount: number;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly options: TerrainOptions;
  /** Tiles that exist, per level. */
  private readonly present: Set<string>[];
  private readonly tiles = new Map<string, Tile>();
  private readonly queue: Tile[] = [];
  private loading = 0;
  private frame = 0;

  constructor(gl: WebGL2RenderingContext, options: TerrainOptions) {
    this.gl = gl;
    this.options = options;
    this.present = options.index.levels.map((l) => new Set(l.tiles));
    this.tileProgram = program(gl, TILE_VERTEX, TILE_FRAGMENT);
    this.seaProgram = program(gl, SEA_VERTEX, SEA_FRAGMENT);

    // One grid mesh, placed on each tile by u_box.
    const uv: number[] = [];
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++) uv.push(i / GRID, j / GRID);
    const indices: number[] = [];
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i;
        const b = a + GRID + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    this.indexCount = indices.length;
    this.tileMesh = gl.createVertexArray();
    gl.bindVertexArray(this.tileMesh);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    const a_uv = gl.getAttribLocation(this.tileProgram, 'a_uv');
    gl.enableVertexAttribArray(a_uv);
    gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW,
    );

    // One triangle covering the viewport.
    this.seaMesh = gl.createVertexArray();
    gl.bindVertexArray(this.seaMesh);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const a_position = gl.getAttribLocation(this.seaProgram, 'a_position');
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    for (const key of options.index.levels[0]?.tiles ?? []) {
      const [x, y] = key.split(',').map(Number);
      this.tile(0, x!, y!);
    }
  }

  private uniform(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = `${p === this.seaProgram ? 'sea' : 'tile'}:${name}`;
    if (!this.uniforms.has(key))
      this.uniforms.set(key, this.gl.getUniformLocation(p, name));
    return this.uniforms.get(key)!;
  }

  private exists(level: number, x: number, y: number): boolean {
    return this.present[level]?.has(`${x},${y}`) ?? false;
  }

  /** The tile, queued for loading the first time it is asked for. */
  private tile(level: number, x: number, y: number): Tile {
    const key = tileKey(level, x, y);
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = {
        key,
        level,
        box: tileBounds(level, x, y),
        state: 'loading',
        used: 0,
        ...(level === 0 ? { pinned: true } : {}),
      };
      this.tiles.set(key, tile);
      this.queue.push(tile);
    }
    tile.used = this.frame;
    return tile;
  }

  private pump(): void {
    while (this.loading < MAX_LOADING && this.queue.length) {
      const tile = this.queue.shift()!;
      // Skip tiles nobody has needed since they were queued.
      if (!tile.pinned && tile.used < this.frame - 1) {
        this.tiles.delete(tile.key);
        continue;
      }
      this.loading++;
      // Decoded off the main thread, as stored: the channels are data.
      fetch(
        `${this.options.url}${tile.key}.webp?v=${this.options.index.hash.slice(0, 12)}`,
      )
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        })
        .then((blob) =>
          createImageBitmap(blob, {
            colorSpaceConversion: 'none',
            premultiplyAlpha: 'none',
          }),
        )
        .then((bitmap) => {
          tile.texture = this.upload(bitmap);
          bitmap.close();
          tile.state = 'ready';
          this.options.onTile();
        })
        .catch(() => {
          tile.state = 'failed';
        })
        .finally(() => {
          this.loading--;
          this.pump();
        });
    }
  }

  private upload(image: ImageBitmap): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private evict(): void {
    const ready = [...this.tiles.values()].filter(
      (t) => t.texture && !t.pinned,
    );
    if (ready.length <= MAX_TEXTURES) return;
    ready.sort((a, b) => a.used - b.used);
    for (const tile of ready.slice(0, ready.length - MAX_TEXTURES)) {
      if (tile.used === this.frame) break;
      this.gl.deleteTexture(tile.texture!);
      this.tiles.delete(tile.key);
    }
  }

  /** Draw at `ratio` device pixels per CSS pixel; the canvas must already be sized. */
  draw(
    view: View,
    width: number,
    height: number,
    ratio: number,
    theme: Theme,
  ): void {
    this.frame++;
    const gl = this.gl;
    gl.viewport(0, 0, Math.round(width * ratio), Math.round(height * ratio));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const k = createProjection(view, width, height).scale();
    const sea = hex(theme.sea);

    // Open sea over the globe's disc.
    gl.useProgram(this.seaProgram);
    gl.uniform2f(this.uniform(this.seaProgram, 'u_size'), width, height);
    gl.uniform1f(this.uniform(this.seaProgram, 'u_ratio'), ratio);
    gl.uniform1f(this.uniform(this.seaProgram, 'u_k'), k);
    gl.uniform3f(this.uniform(this.seaProgram, 'u_seaColor'), ...sea);
    gl.bindVertexArray(this.seaMesh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Land tiles over it.
    const p = this.tileProgram;
    gl.useProgram(p);
    gl.uniform2f(this.uniform(p, 'u_size'), width, height);
    gl.uniform1f(this.uniform(p, 'u_k'), k);
    gl.uniform2f(
      this.uniform(p, 'u_center'),
      view.center[0] * DEG,
      view.center[1] * DEG,
    );
    const t = theme.terrain;
    gl.uniform3f(this.uniform(p, 'u_seaColor'), ...sea);
    gl.uniform3f(this.uniform(p, 'u_landLow'), ...hex(t.landLow));
    gl.uniform3f(this.uniform(p, 'u_landHigh'), ...hex(t.landHigh));
    gl.uniform1f(this.uniform(p, 'u_shade'), t.shade);
    gl.uniform1f(this.uniform(p, 'u_flatShade'), Math.cos(Math.PI / 4));
    gl.uniform1i(this.uniform(p, 'u_tile'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.tileMesh);
    const pass = (tile: Tile) => {
      gl.uniform4f(this.uniform(p, 'u_box'), ...tile.box);
      gl.bindTexture(gl.TEXTURE_2D, tile.texture!);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    };

    const box = viewBox(view, width, height);
    const level = tileLevelFor(1 / (view.pixelsPerDegree * ratio));
    const inView = (tile: Tile) =>
      tile.box[1] < box[3] &&
      tile.box[3] > box[1] &&
      (box[0] <= box[2]
        ? tile.box[0] < box[2] && tile.box[2] > box[0]
        : tile.box[0] < box[2] || tile.box[2] > box[0]);
    const wanted: Tile[] = [];
    for (const [x, y] of tilesInBox(level, box))
      if (this.exists(level, x, y)) wanted.push(this.tile(level, x, y));
    const missing = wanted.some((tile) => tile.state !== 'ready');
    if (missing) {
      // Until the level is complete, whatever is loaded stands in, coarse
      // to fine: level 0 always, other levels where they are.
      const loaded = [...this.tiles.values()]
        .filter(
          (tile) =>
            tile.state === 'ready' && tile.level !== level && inView(tile),
        )
        .sort((a, b) => a.level - b.level);
      for (const tile of loaded) {
        tile.used = this.frame;
        pass(tile);
      }
    }
    for (const tile of wanted) if (tile.state === 'ready') pass(tile);
    gl.bindVertexArray(null);

    // Load the centre first.
    if (missing) {
      const [cx, cy] = view.center;
      const far = (tile: Tile) =>
        Math.abs((tile.box[0] + tile.box[2]) / 2 - cx) +
        Math.abs((tile.box[1] + tile.box[3]) / 2 - cy);
      this.queue.sort((a, b) => b.level - a.level || far(a) - far(b));
    }
    this.pump();
    this.evict();
  }
}

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { agentRoleForSeat, type AgentRole } from "@/lib/agent-roles";

// Office scenes exported from AgentWorld Studio live in /office-studio/<office-id>.json, where the
// id matches the office image the campaign picked (/offices/<office-id>.png). Each bundle is
// ~12MB of base64 images, so it never goes to the browser as-is: the page gets a small layout
// manifest and the images are served as binary from /api/office-studio/<office>/<asset>.

const SCENES_DIR = path.join(process.cwd(), "office-studio");
const OFFICE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

type SceneBundle = {
  office: { name: string; width: number; height: number; background: string };
  seats: {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    zIndex: number;
    character: {
      id: string;
      name: string;
      width: number;
      height: number;
      sprite: string;
      animations?: Record<string, string[]>;
    };
  }[];
};

// Everything the client needs to draw an office. Coordinates are in the scene's own pixel space
// (office.width × office.height); seat x/y is the character's top-left corner.
export type OfficeScene = {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  agents: OfficeAgent[];
};

export type OfficeAgent = {
  id: string;
  name: string;
  role: AgentRole;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  animation: string | null;
  frames: string[];
};

type LoadedScene = { version: string; bundle: SceneBundle };

// Parsed bundles stay in memory per server process; the version (mtime) busts both this cache and
// the browser's immutable asset cache whenever a scene file is re-exported.
const loaded = new Map<string, Promise<LoadedScene | null>>();

async function loadScene(officeId: string): Promise<LoadedScene | null> {
  if (!OFFICE_ID.test(officeId)) return null;
  const file = path.join(SCENES_DIR, `${officeId}.json`);

  const info = await stat(file).catch(() => null);
  if (!info) return null;
  const version = Math.floor(info.mtimeMs).toString(36);

  const cacheKey = `${officeId}@${version}`;
  let scene = loaded.get(cacheKey);
  if (!scene) {
    scene = readFile(file, "utf8")
      .then((raw) => ({ version, bundle: JSON.parse(raw) as SceneBundle }))
      .catch(() => null);
    for (const key of loaded.keys()) if (key.startsWith(`${officeId}@`)) loaded.delete(key);
    loaded.set(cacheKey, scene);
  }
  return scene;
}

// "/offices/wooden-office.png" -> "wooden-office"
export function officeIdFromImage(officeImage: string) {
  return path.basename(officeImage).replace(/\.[^.]+$/, "");
}

export async function getOfficeScene(officeId: string): Promise<OfficeScene | null> {
  const scene = await loadScene(officeId);
  if (!scene) return null;
  const { bundle, version } = scene;
  const asset = (name: string) => `/api/office-studio/${officeId}/${name}?v=${version}`;

  return {
    id: officeId,
    name: bundle.office.name,
    width: bundle.office.width,
    height: bundle.office.height,
    background: asset("background"),
    agents: bundle.seats.map((seat, index) => {
      const { character } = seat;
      const [animation, frames] = Object.entries(character.animations ?? {}).find(([, f]) => f.length > 0) ?? [];
      return {
        id: seat.id,
        name: character.name,
        role: agentRoleForSeat(index),
        x: seat.x,
        y: seat.y,
        width: seat.width,
        height: (seat.width * character.height) / character.width,
        zIndex: seat.zIndex,
        animation: animation ?? null,
        frames: frames?.length
          ? frames.map((_, i) => asset(`seats/${seat.id}/${animation}/${i}`))
          : [asset(`seats/${seat.id}/sprite`)],
      };
    }),
  };
}

// Resolves an asset path from getOfficeScene back to its decoded image.
export async function getOfficeAsset(officeId: string, assetPath: string[]) {
  const scene = await loadScene(officeId);
  if (!scene) return null;
  const { bundle } = scene;

  let dataUri: string | undefined;
  if (assetPath.length === 1 && assetPath[0] === "background") {
    dataUri = bundle.office.background;
  } else if (assetPath[0] === "seats") {
    const character = bundle.seats.find((seat) => seat.id === assetPath[1])?.character;
    if (assetPath.length === 3 && assetPath[2] === "sprite") dataUri = character?.sprite;
    if (assetPath.length === 4) dataUri = character?.animations?.[assetPath[2]]?.[Number(assetPath[3])];
  }

  const match = dataUri?.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  if (!match) return null;
  return { contentType: match[1], body: Buffer.from(match[2], "base64") };
}

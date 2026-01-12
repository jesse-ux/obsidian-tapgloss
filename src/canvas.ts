import { App, TFile } from "obsidian";

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface CanvasEdge {
  id?: string;
  fromNode?: string;
  fromSide?: string;
  toNode?: string;
  toSide?: string;
  [key: string]: unknown;
}

interface CanvasNode {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color?: string;
}

export async function appendToCanvas(app: App, rawPath: string, text: string): Promise<void> {
  const path = normalizeCanvasPath(rawPath);
  let data: CanvasData = { nodes: [], edges: [] };
  let file = app.vault.getAbstractFileByPath(path);

  try {
    if (!file) {
      await ensureParentFolder(app, path);
      file = await app.vault.create(path, JSON.stringify(data, null, 2));
    }
    if (!(file instanceof TFile)) {
      throw new Error("Canvas path is not a file.");
    }
    const existing = await app.vault.read(file);
    const parsed = JSON.parse(existing) as unknown;
    const record = isRecord(parsed) ? parsed : {};
    data = {
      nodes: Array.isArray(record.nodes) ? (record.nodes as CanvasNode[]) : [],
      edges: Array.isArray(record.edges) ? (record.edges as CanvasEdge[]) : []
    };
  } catch {
    data = { nodes: [], edges: [] };
  }

  const position = computeNextPosition(data.nodes);
  const node: CanvasNode = {
    id: randomHexId(),
    type: "text",
    x: position.x,
    y: position.y,
    width: 380,
    height: 220,
    text
  };

  data.nodes.push(node);
  if (!file || !(file instanceof TFile)) {
    file = app.vault.getAbstractFileByPath(path);
  }
  if (file instanceof TFile) {
    await app.vault.modify(file, JSON.stringify(data, null, 2));
  } else {
    throw new Error("Failed to write canvas file.");
  }
}

function normalizeCanvasPath(rawPath: string): string {
  const trimmed = rawPath.trim() || "TrickyWords.canvas";
  return trimmed.endsWith(".canvas") ? trimmed : `${trimmed}.canvas`;
}

function computeNextPosition(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0 };
  }
  const maxY = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0);
  return { x: 0, y: maxY + 60 };
}

function randomHexId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
  const folderPath = path.split("/").slice(0, -1).join("/");
  if (!folderPath) return;
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (!existing) {
    await app.vault.createFolder(folderPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

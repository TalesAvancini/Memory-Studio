import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, Document } from 'yaml';

/**
 * Phase 4.2 normalized catalog item shapes surfaced to the UI.
 *
 * Phase 1's `src/catalog/schema/**` is the source of truth; this module is
 * a read-only adapter that consumes the same YAML and exposes a UI-friendly
 * discriminated union. The adapter does NOT modify Phase 1 files; it merely
 * inspects their YAML representation.
 */
export type UiCatalogItem =
  | {
      id: string;
      type: 'skill';
      title: string;
      category: string;
      text: string;
    }
  | {
      id: string;
      type: 'rule';
      critical: boolean;
      text: string;
    }
  | {
      id: string;
      type: 'persona';
      isDefault: boolean;
      text: string;
    };

export type UiCatalogType = 'skill' | 'rule' | 'persona';

export interface CatalogReader {
  list(): Promise<readonly UiCatalogItem[]>;
  get(id: string): Promise<UiCatalogItem | undefined>;
}

export class CatalogUnavailableError extends Error {
  readonly code = 'CATALOG_UNAVAILABLE';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CatalogUnavailableError';
    this.cause = cause;
  }
}

export interface CatalogFileSystem {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string): Promise<readonly string[]>;
}

const NODE_FILE_SYSTEM: CatalogFileSystem = {
  readFile: (path, encoding) => readFile(path, encoding),
  readdir: (path) => readdir(path),
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeItem(record: Record<string, unknown>): UiCatalogItem | null {
  const id = record['id'];
  const type = record['type'];
  const text = record['text'];
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof text !== 'string' || text.length === 0) return null;

  switch (type) {
    case 'skill': {
      const title = record['title'];
      const category = record['category'];
      if (typeof title !== 'string' || title.length === 0) return null;
      if (typeof category !== 'string' || category.length === 0) return null;
      return { id, type: 'skill', title, category, text };
    }
    case 'rule': {
      const critical = record['critical'] === true;
      return { id, type: 'rule', critical, text };
    }
    case 'persona': {
      const isDefault = record['isDefault'] === true;
      return { id, type: 'persona', isDefault, text };
    }
    default:
      // Unknown / malformed types are silently skipped so a single bad file
      // cannot take down the whole catalog UI.
      return null;
  }
}

function compareById(a: UiCatalogItem, b: UiCatalogItem): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function isYamlFile(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml');
}

export interface FileSystemCatalogReaderOptions {
  /** Override the filesystem operations (used by tests). */
  fileSystem?: Partial<CatalogFileSystem>;
}

export function createFileSystemCatalogReader(
  yamlDir: string,
  options: FileSystemCatalogReaderOptions = {},
): CatalogReader {
  const fileSystem: CatalogFileSystem = { ...NODE_FILE_SYSTEM, ...options.fileSystem };
  let cache: readonly UiCatalogItem[] | undefined;

  async function loadAll(): Promise<readonly UiCatalogItem[]> {
    if (cache) return cache;
    let entries: readonly string[];
    try {
      entries = await fileSystem.readdir(yamlDir);
    } catch (cause) {
      throw new CatalogUnavailableError(
        `Cannot read catalog directory: ${yamlDir}`,
        cause,
      );
    }
    const files = entries.filter(isYamlFile).sort();
    const items: UiCatalogItem[] = [];
    for (const file of files) {
      const path = join(yamlDir, file);
      let raw: string;
      try {
        raw = await fileSystem.readFile(path, 'utf8');
      } catch (cause) {
        throw new CatalogUnavailableError(
          `Cannot read catalog file: ${path}`,
          cause,
        );
      }
      if (raw.trim().length === 0) continue;
      let parsed: unknown;
      try {
        const doc = parseYaml(raw);
        parsed = doc instanceof Document ? doc.toJSON() : doc;
      } catch (cause) {
        throw new CatalogUnavailableError(
          `Cannot parse catalog file: ${path}`,
          cause,
        );
      }
      if (!isPlainRecord(parsed)) continue;
      const item = normalizeItem(parsed);
      if (item) items.push(item);
    }
    items.sort(compareById);
    cache = items;
    return items;
  }

  return {
    async list() {
      return loadAll();
    },
    async get(id: string) {
      const items = await loadAll();
      return items.find((item) => item.id === id);
    },
  };
}

export function createEmptyCatalogReader(
  items: readonly UiCatalogItem[] = [],
): CatalogReader {
  const sorted = [...items].sort(compareById);
  return {
    async list() {
      return sorted;
    },
    async get(id: string) {
      return sorted.find((item) => item.id === id);
    },
  };
}

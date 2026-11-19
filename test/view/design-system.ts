// The Design System a view frame holds before the view's own code runs, taken
// from the Frontier checkout through the module's provider, so a browser test
// draws the view as Frontier does: its stylesheet, its tokens and its
// Behaviors, in the colour scheme the root element names.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface DesignSystemPage {
  stylesheet: string;
  behaviorsScript: string;
}

type Build = (options: Record<string, unknown>) => { outputFiles: { text: string }[] };

export async function loadDesignSystem(frontier: string, buildSync: Build): Promise<DesignSystemPage> {
  const built = buildSync({
    entryPoints: [join(frontier, 'modules', 'typescript', 'design_system', 'provider.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0]!.text;
  const directory = mkdtempSync(join(tmpdir(), 'design-system-'));
  try {
    const file = join(directory, 'design-system.mjs');
    writeFileSync(file, built);
    const { designSystemProvider } = (await import(pathToFileURL(file).href)) as {
      designSystemProvider: { provide(dependencies: Record<string, never>): DesignSystemPage | Promise<DesignSystemPage> };
    };
    const designSystem = await designSystemProvider.provide({});
    return { stylesheet: designSystem.stylesheet, behaviorsScript: designSystem.behaviorsScript };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// A view frame's document before the view mounts, in `mode`.
export function frameDocument(designSystem: DesignSystemPage, mode: 'dark' | 'light'): string {
  return `<!doctype html><html data-mode="${mode}"><head><meta charset="utf-8"><style>${designSystem.stylesheet}</style></head><body></body></html>`;
}

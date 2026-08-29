import { defineConfig } from 'vitest/config';

// `src/lib/core/` and `src/lib/server/` are deliberately framework-free, so the
// unit suite needs no Svelte plugin and no DOM — it runs as plain TypeScript in
// node, which keeps these tests fast enough to leave in watch mode while working.
export default defineConfig({
	test: {
		name: 'unit',
		environment: 'node',
		// Vitest stubs CSS imports with an empty string by default. `themes.test.ts`
		// reads `tokens.css` as text to check the palettes against the catalogue, so
		// it needs the real file rather than the stub.
		css: true,
		include: ['src/lib/{core,server}/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/{core,server}/**/*.ts'],
			exclude: ['src/lib/**/*.test.ts', 'src/lib/core/github/fake.ts']
		}
	}
});

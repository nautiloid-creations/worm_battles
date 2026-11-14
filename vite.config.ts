import { defineConfig, Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function stemsPlugin(): Plugin {
  return {
    name: 'stems-dir-scanner',
    configureServer(server) {
      server.middlewares.use('/api/stems', (_req, res) => {
        const stemsDir = path.resolve(__dirname, 'public/assets/audio/stems');
        if (!fs.existsSync(stemsDir)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify([]));
          return;
        }
        const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
        const files = fs
          .readdirSync(stemsDir)
          .filter((f) => audioExts.some((ext) => f.toLowerCase().endsWith(ext)));

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(files));
      });

      server.middlewares.use('/api/save-ultimate', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const { charId, sequence } = JSON.parse(body);
              if (!charId || !sequence) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing charId or sequence' }));
                return;
              }
              const targetDir = path.resolve(__dirname, `assets_src/characters/${charId}`);
              fs.mkdirSync(targetDir, { recursive: true });
              const targetPath = path.join(targetDir, 'ultimate.json');
              fs.writeFileSync(targetPath, JSON.stringify(sequence, null, 2) + '\n');
              console.log(`💾 Saved ultimate sequence -> assets_src/characters/${charId}/ultimate.json`);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, path: targetPath }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
      });
    },
    buildStart() {
      const stemsDir = path.resolve(__dirname, 'public/assets/audio/stems');
      if (fs.existsSync(stemsDir)) {
        const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
        const files = fs
          .readdirSync(stemsDir)
          .filter((f) => audioExts.some((ext) => f.toLowerCase().endsWith(ext)));
        fs.writeFileSync(path.join(stemsDir, 'manifest.json'), JSON.stringify(files, null, 2));
      }
    },
  };
}

export default defineConfig({
  plugins: [stemsPlugin()],
  server: {
    port: 5173,
    open: false,
  },
});

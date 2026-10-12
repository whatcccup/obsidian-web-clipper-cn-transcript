"""Exercise the install menu in a disposable home with stub runtimes only."""
import os
import pty
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

INSTALLER = Path(__file__).resolve().parents[1] / 'install.sh'


class InstallerMenuTests(unittest.TestCase):
    def run_install(self, choices, machine='arm64', args=()):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / 'project'
            (project / 'extension/dist').mkdir(parents=True)
            (project / 'extension/dist/manifest.json').write_text('{}')
            shutil.copy2(INSTALLER, project / 'install.sh')
            commands = root / 'bin'
            commands.mkdir()
            for name, body in {
                'node': 'echo 24', 'uv': 'exit 0',
                'uname': 'if [ "$1" = "-s" ]; then echo Darwin; else echo ' + machine + '; fi',
            }.items():
                executable = commands / name
                executable.write_text('#!/bin/bash\n' + body + '\n')
                executable.chmod(0o755)
            (project / 'launcher').mkdir()
            (project / 'launcher/install-transcript.sh').write_text('''#!/bin/bash
set -eu
TARGET="$HOME/Library/Application Support/ObsidianWebClipperCNTranscript/helper/.venv/bin"
mkdir -p "$TARGET"
cat > "$TARGET/python" <<'SH'
#!/bin/bash
printf '%s\\n' "$@" > "$HOME/download-args"
cat >/dev/null
SH
chmod +x "$TARGET/python"
''')
            env = dict(os.environ, HOME=str(root), PATH=str(commands) + ':/usr/bin:/bin')
            master, slave = pty.openpty()
            try:
                proc = subprocess.Popen(['/bin/bash', str(project / 'install.sh'), *args], stdin=slave,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
                os.close(slave)
                os.write(master, choices.encode())
                output, _ = proc.communicate(timeout=10)
                self.assertEqual(proc.returncode, 0, output)
            finally:
                os.close(master)
            args_file = root / 'download-args'
            return output, args_file.read_text().splitlines() if args_file.exists() else []

    def test_each_engine_selection_reaches_download(self):
        for choice, provider in [('1', 'faster-whisper'), ('2', 'openai-whisper'), ('3', 'mlx-whisper')]:
            _, args = self.run_install(choice + '\n1\n')
            self.assertEqual(args, ['-', 'tiny', provider])

    def test_intel_rejects_mlx_without_installing_its_model(self):
        output, args = self.run_install('3\n2\n1\n', machine='x86_64')
        self.assertIn('MLX Whisper requires', output)
        self.assertEqual(args, ['-', 'tiny', 'openai-whisper'])

    def test_skip_and_unattended_do_not_download_models(self):
        self.assertEqual(self.run_install('4\n')[1], [])
        self.assertEqual(self.run_install('\n', args=('--yes',))[1], [])


if __name__ == '__main__':
    unittest.main()

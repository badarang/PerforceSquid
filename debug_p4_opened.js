const { spawn } = require('child_process');

function runCommand(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('p4', args, { shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 || stdout) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });
  });
}

async function main() {
  try {
    console.log('Running p4 -ztag opened //...');
    const output = await runCommand(['-ztag', 'opened', '//...']);
    console.log('Output length:', output.length);
    console.log('Raw output sample:');
    console.log(output.substring(0, 500));
    
    const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let currentFile = {};
    const files = [];
    
    const pushCurrentFile = () => {
        if (currentFile.depotFile) {
          files.push(currentFile);
        }
        currentFile = {};
      }

      for (const line of lines) {
        const match = line.match(/^\.\.\s+(\w+)\s+(.*)$/);
        if (!match) {
          if (line.trim() === '') pushCurrentFile();
          continue;
        }

        const [, key, value] = match;
        const trimmedValue = value.trim();

        if (key === 'depotFile' && currentFile.depotFile) {
          pushCurrentFile();
        }

        currentFile[key] = trimmedValue;
      }
      pushCurrentFile();

      console.log('Parsed files:', files.length);
      if (files.length > 0) {
        console.log('First file:', files[0]);
      }
      
  } catch (err) {
    console.error('Error:', err);
  }
}

main();

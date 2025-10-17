const fs = require('fs');
const path = require('path');

// Crear carpeta build
if (fs.existsSync('build')) {
  fs.rmSync('build', { recursive: true });
}
fs.mkdirSync('build');

// Archivos a copiar
const filesToCopy = [
  'server.js',
  'package.json',
  '.env'
];

// Carpetas a copiar
const foldersToCopy = [
  'config',
  'invitados'
];

// Copiar archivos
filesToCopy.forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join('build', file));
    console.log(`✅ Copiado: ${file}`);
  }
});

// Copiar carpetas
foldersToCopy.forEach(folder => {
  if (fs.existsSync(folder)) {
    fs.cpSync(folder, path.join('build', folder), { recursive: true });
    console.log(`✅ Copiado: ${folder}/`);
  }
});

console.log('🎉 Build completado en ./build/');
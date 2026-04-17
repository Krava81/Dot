import fs from 'fs';

async function test() {
  const fd = new FormData();
  const file = new Blob([fs.readFileSync('package.json')]);
  fd.append('file', file, 'package.json');
  console.log('FormData works');
}
test();

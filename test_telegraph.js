const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

async function testTelegraph() {
  const form = new FormData();
  // Create a small placeholder image
  fs.writeFileSync('test.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  form.append('file', fs.createReadStream('test.png'));

  try {
    const res = await axios.post('https://telegra.ph/upload', form, {
      headers: form.getHeaders(),
    });
    console.log(res.data);
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
testTelegraph();

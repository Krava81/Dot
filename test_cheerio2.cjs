const { load } = require("cheerio");
const html = "<b>hello</b>".slice(0, 2); // "<b"
console.log(load(html, null, false).html());
const html2 = "<b>hello</b>".slice(0, 3); // "<b>"
console.log(load(html2, null, false).html());
const html3 = "<b>hello</b>".slice(0, 5); // "<b>he"
console.log(load(html3, null, false).html());

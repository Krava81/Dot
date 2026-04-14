const { load } = require("cheerio");
const html = "<b>hello &amp; world</b>";
console.log(load(html, null, false).html());

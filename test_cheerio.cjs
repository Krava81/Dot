const { load } = require("cheerio");
const html = "<b>bold text";
const $ = load(html, null, false);
console.log($.html());

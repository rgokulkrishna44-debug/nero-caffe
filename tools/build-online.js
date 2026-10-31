// Builds a single self-contained HTML page for online hosting (served by the n8n
// "NERO Caffe Website" workflow). Run: node tools/build-online.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RESERVATION_URL = "https://n8n.luvias.in/webhook/nero-reservation";
const UNSPLASH = {
  hero: "1461988091159-192b6df7054f",
  interior: "1554118811-1e0d58224f24",
  latte: "1509042239860-f550ce710b93",
  pastry: "1509440159596-0249088772ff",
  beans: "1447933601403-0c6688de566e",
  espresso: "1495474472287-4d71bcdd2085",
  pizza: "1513104890138-7c749659a591",
  burger: "1568901346375-23c9450c58cd",
  croissant: "1555507036-ab1f4038808a",
  "cafe-people": "1501339847302-ac426a4a7cbb",
  barista: "1559925393-8be0ec4767c8",
  "cup-table": "1511920170033-f8396924c348",
  "cups-top": "1453614512568-c4024d13c247",
  tiramisu: "1571877227200-a0d98ea607e9",
  crema: "1514432324607-a09d9b4aefdd",
  "grind-board": "1497935586351-b67a49e012bf",
  "iced-latte": "1461023058943-07fcbe16d735",
};

const menu = require(path.join(root, "data", "menu.js"));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/\n?/g, "").replace(/^\s*\n/gm, "");
const css = stripComments(read("public/styles.css"));
const js = stripComments(read("public/script.js")).replace('"/api/reservations"', JSON.stringify(RESERVATION_URL));

let html = read("public/index.html")
  .replace('<link rel="stylesheet" href="styles.css" />', () => "<style>\n" + css + "</style>")
  // The live page has no Express back end, so it ships without the order-ahead cart.
  .replace('\n  <link rel="stylesheet" href="order.css" />', "")
  .replace('<script src="order.js"></script>\n  ', "")
  .replace('<script src="script.js"></script>', () =>
    "<script>window.NERO_MENU = " + JSON.stringify(menu) + ";</script>\n<script>\n" + js + "</script>"
  )
  .replace(/images\/([a-z-]+)\.jpg/g, (match, name) => {
    const id = UNSPLASH[name];
    if (!id) throw new Error("No Unsplash id for image: " + name);
    const width = name === "hero" ? 2000 : 1200;
    return "https://images.unsplash.com/photo-" + id + "?auto=format&fit=crop&w=" + width + "&q=80";
  });

const out = path.join(root, "..", "online-demo", "index.html");
fs.writeFileSync(out, html);
console.log("Wrote " + out + " (" + Math.round(html.length / 1024) + " KB)");

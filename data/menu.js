// veg: true = vegetarian, false = non-vegetarian, omitted = not marked (drinks)
module.exports = {
  hotBeverages: {
    label: "Hot Beverages",
    items: [
      { name: "Espresso", price: 120 },
      { name: "Doppio", price: 150 },
      { name: "Macchiato", price: 140 },
      { name: "Cappuccino", price: 160 },
      { name: "Cortado", price: 160 },
      { name: "Hot Chocolate", price: 170, note: "Dark couverture, whipped cream on request" },
    ],
  },
  coldDrinks: {
    label: "Cold Drinks",
    items: [
      { name: "Iced Latte", price: 180 },
      { name: "Cold Brew", price: 170, note: "Steeped 18 hours" },
      { name: "Shakerato", price: 190, note: "Shaken espresso, sugar, ice" },
      { name: "Italian Soda", price: 140 },
      { name: "Fresh Lemonade", price: 120 },
    ],
  },
  pastries: {
    label: "Pastries & Bakes",
    items: [
      { name: "Cornetto Sfogliato", price: 130, veg: true },
      { name: "Maritozzo", price: 150, veg: true, note: "Whipped cream bun" },
      { name: "Bombolone", price: 140, veg: true },
      { name: "Biscotti (3pc)", price: 110, veg: true },
      { name: "Tiramisù", price: 220, veg: true },
    ],
  },
  burgers: {
    label: "Burgers",
    items: [
      { name: "Classic Pollo", price: 360, veg: false, note: "Double chicken patty, aged cheddar, house sauce" },
      { name: "Pollo Piccante", price: 340, veg: false, note: "Crispy chicken, chilli honey, slaw" },
      { name: "Burrata & Portobello", price: 380, veg: true, note: "Grilled portobello, burrata, rocket, balsamic" },
    ],
  },
  pizzas: {
    label: "Wood-fired Pizzas",
    items: [
      { name: "Margherita", price: 360, veg: true, note: "San Marzano tomato, fior di latte, basil" },
      { name: "Diavola", price: 420, veg: false, note: "Spicy chicken salami, chilli oil" },
      { name: "Quattro Formaggi", price: 430, veg: true, note: "Mozzarella, gorgonzola, fontina, parmigiano" },
      { name: "Funghi", price: 400, veg: true, note: "Wild mushroom, truffle oil" },
    ],
  },
};

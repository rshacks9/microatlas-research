
const search = document.querySelector('[data-search]');
const pills = [...document.querySelectorAll('[data-filter]')];
const cards = [...document.querySelectorAll('.report-card')];
let active = 'All';
function render(){
  const q = (search?.value || '').toLowerCase().trim();
  cards.forEach(card => {
    const cat = card.dataset.category || '';
    const hay = `${card.dataset.title} ${card.dataset.keywords} ${cat}`.toLowerCase();
    const okCat = active === 'All' || cat === active;
    const okQ = !q || hay.includes(q);
    card.style.display = okCat && okQ ? '' : 'none';
  });
}
pills.forEach(p => p.addEventListener('click', () => {
  active = p.dataset.filter;
  pills.forEach(x => x.classList.toggle('active', x === p));
  render();
}));
search?.addEventListener('input', render);
render();
fetch((document.currentScript?.src || '').includes('/assets/') ? (document.currentScript.src.replace(/assets\/storefront\.js.*/, 'assets/checkout-links.json')) : 'assets/checkout-links.json')
  .then(r => r.ok ? r.json() : {})
  .then(links => {
    document.querySelectorAll('[data-buy]').forEach(a => {
      const sku = a.dataset.buy;
      if (links[sku] && !String(links[sku]).includes('REPLACE_')) a.href = links[sku];
    });
  })
  .catch(() => {});

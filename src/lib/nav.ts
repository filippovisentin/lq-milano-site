export const services = [
  { id: 'consulenza-moda', title: 'Consulenza moda', short: 'Campagne vendita e consulenza stilistica per brand' },
  { id: 'noleggio', title: 'Noleggio per cinema e spettacolo', short: 'Capi e accessori d’epoca per set, teatro e shooting' },
  { id: 'workshop', title: 'Workshop ed eventi', short: 'Uno spazio per giovani creativi e brand emergenti' },
  { id: 'upcycling', title: 'Upcycling e sartoria', short: 'Capi vintage trasformati con tessuti di recupero' },
  { id: 'pellicce-vintage', title: 'Pellicce vintage all’ingrosso', short: 'Fornitura per rivenditori, catalogata per anno' },
];

export const mainNav = [
  { href: '/shop', label: 'Shop' },
  { href: '/concept-store', label: 'Il negozio' },
  {
    label: 'Servizi',
    href: '/servizi',
    children: [
      ...services.map((s) => ({ href: `/servizi#${s.id}`, label: s.title, desc: s.short })),
    ],
    extra: [
      { href: '/fornitura', label: 'Fornitura pellicce', desc: 'Richiedi il linesheet' },
      { href: '/galleria', label: 'Archivio per noleggio', desc: 'L’archivio raccontato' },
    ],
  },
  { href: '/eventi', label: 'Eventi' },
  { href: '/contatti', label: 'Chi siamo e contatti' },
] as const;

export const footerNav = [
  {
    title: 'Negozio',
    links: [
      { href: '/shop', label: 'Shop' },
      { href: '/concept-store', label: 'Il negozio' },
      { href: '/galleria', label: 'Archivio per noleggio' },
      { href: '/eventi', label: 'Eventi e workshop' },
    ],
  },
  {
    title: 'Servizi',
    links: [
      { href: '/servizi#consulenza-moda', label: 'Consulenza moda' },
      { href: '/servizi#noleggio', label: 'Noleggio cinema e spettacolo' },
      { href: '/servizi#upcycling', label: 'Upcycling e sartoria' },
      { href: '/fornitura', label: 'Fornitura pellicce' },
    ],
  },
  {
    title: 'LQ Milano',
    links: [
      { href: '/contatti', label: 'Chi siamo e contatti' },
      { href: '/account', label: 'Accedi' },
      { href: '/cart-page', label: 'Carrello' },
    ],
  },
];

export const isActive = (current: string, href: string) => {
  const path = href.split('#')[0];
  if (path === '/') return current === '/';
  return current === path || current.startsWith(path + '/') || (path === '/shop' && current.startsWith('/product-page'))
    || (path === '/eventi' && current.startsWith('/event-details'));
};

export const euro = (n: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);

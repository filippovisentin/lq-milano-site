// Named page imagery. Every file is the original LQ Milano photo (Wix master,
// see ../../asset-manifest.json for the source identity of each one).
import storefront from '../assets/media/8198f7_06e077d476ea42afa590a5ec08d0a65b_mv2.webp';
import neonSign from '../assets/media/8198f7_138e98d2a6d747069010d0f2f53b43de_mv2.webp';
import logoPaper from '../assets/media/8198f7_d6e53810866c436d94c0bc118aa1d637_mv2.webp';
// Chi siamo
import aboutBanner from '../assets/media/8198f7_921371d24a854b9fb64de02d215008c0_mv2.webp';
import lea from '../assets/media/8198f7_7bcbf164a2a2464e8694a3204c918c71_mv2.webp';
import antonio from '../assets/media/8198f7_2de6437e02834d0e84259a8efe576c92_mv2.webp';
import switchLogo from '../assets/media/8198f7_0aa5eb487d6d4ea3affc1aa313356818_mv2.webp';
import switchStyle from '../assets/media/8198f7_2da01b61f60840c98ee0a9e0f810d4eb_mv2.webp';
import greenPlanner from '../assets/media/8198f7_a525be673d834a44b18b18d0533a9741_mv2.webp';
// Concept store
import storeBanner from '../assets/media/8198f7_96c64530c6704eafa061c47b4a2114e8_mv2.webp';
import ingresso from '../assets/media/8198f7_1f082263e2bb4bb2b86940a36942114f_mv2.webp';
import corridoio from '../assets/media/8198f7_b9c95052b2ee45d183b7ea9e2d141c6e_mv2.webp';
import angolo from '../assets/media/8198f7_b141716575454b11b5270af869d5264c_mv2.webp';
import stanza from '../assets/media/8198f7_6c2d82e6e42842a2afc54452f0a6d2fc_mv2.webp';
// Servizi
import servicesBanner from '../assets/media/8198f7_03b6f8f2f19d4f3aa17bf529153180f2_mv2.webp';
import sConsulenza from '../assets/media/svc-consulenza.webp';
import sNoleggio from '../assets/media/svc-noleggio.webp';
import sConcept from '../assets/media/svc-concept.webp';
import sEventi from '../assets/media/svc-workshop.webp';
import sUpcycling from '../assets/media/svc-upcycling.webp';
import sPellicce from '../assets/media/svc-pellicce.webp';
// Galleria
import galleryBanner from '../assets/media/8198f7_3f09d7d447904293bea8ce21209753bb_mv2.webp';
import gAmericanino from '../assets/media/8198f7_62bc0967fc374afa806e9bbb53e395c7_mv2.webp';
import gHamilton from '../assets/media/8198f7_ea69499454f441b58966b5a4deedb9c8_mv2.webp';
import gHermes from '../assets/media/8198f7_97d954d9fb534cf3a80aba1ae4b2b572_mv2.webp';
import gYsl from '../assets/media/8198f7_62eabf373d624c6d85cb9f8b172dd1cc_mv2.webp';
// Eventi
import eventsBanner from '../assets/media/8198f7_a77daa37d500449f871f746aa32a8753_mv2.webp';
// Fornitura
import furCarpet from '../assets/media/448ae6bd5c874809bf7a13882cbcd62e.webp';
import fur1 from '../assets/media/8198f7_038979dd14d74748a615e7112b8a18b4_mv2.webp';
import fur2 from '../assets/media/8198f7_7f8f7fa44caa49ba9bf7451ce0b58d53_mv2.webp';
import fur3 from '../assets/media/8198f7_864a8d900a63409982b8a3d420ee334c_mv2.webp';
import fur4 from '../assets/media/8198f7_7f8e30a83fc4493f808e976609d50a32_mv2.webp';

export const media = {
  storefront, neonSign, logoPaper,
  aboutBanner, lea, antonio, switchLogo, switchStyle, greenPlanner,
  storeBanner, ingresso, corridoio, angolo, stanza,
  servicesBanner, sConsulenza, sNoleggio, sConcept, sEventi, sUpcycling, sPellicce,
  galleryBanner, gAmericanino, gHamilton, gHermes, gYsl,
  eventsBanner,
  furCarpet, fur1, fur2, fur3, fur4,
};

export const rooms = [
  {
    id: 'ingresso', title: 'L’ingresso', img: ingresso, alt: 'L’ingresso di LQ Milano: scaffali con borse, camicie e accessori vintage',
    text: 'Entrando da LQ MILANO, sei subito avvolto da un\'atmosfera calda e accogliente. Gli scaffali sono pieni di abiti, accessori e scarpe che spaziano da epoche diverse, permettendo di trovare pezzi straordinari che raccontano storie. I vestiti sono ben organizzati per stile e taglie, rendendo facile la ricerca, ma per ogni dubbio o necessità c’è sempre la titolare Lea pronta ad aiutarti.',
  },
  {
    id: 'corridoio', title: 'Il corridoio', img: corridoio, alt: 'Il corridoio interno del negozio con capi appesi e grafiche LQ Milano',
    text: 'Proseguendo oltre l’ingresso, il negozio si apre in un corridoio interno dove l’esperienza diventa ancora più personale. Qui non troverai solo capi vintage unici, ma anche pezzi stampati con le grafiche esclusive di LQ Milano. Ogni capo può trasformarsi nel tuo preferito: puoi scegliere quello che ti piace e farlo stampare direttamente in negozio.',
    tag: 'Stampa personalizzata in negozio',
  },
  {
    id: 'angolo-creativo', title: 'L’Angolo Creativo', img: angolo, alt: 'L’Angolo Creativo: lo spazio sartoria e customizzazione',
    text: 'Al termine del corridoio si apre un angolo dedicato alla sartoria e alla customizzazione. Qui il vintage incontra il "su misura": da LQ MILANO non ci si limita a vendere capi, ma offriamo un servizio di sartoria di base — dagli orli, al restringere un pantalone o accorciare una giacca — fino a veri e propri progetti di upcycling e personalizzazione su misura. Che si tratti di un tuo capo personale o di un acquisto in negozio, potrai modificarlo e renderlo davvero unico, proprio come te.',
    tag: 'Sartoria di base e upcycling',
  },
  {
    id: 'stanza-segreta', title: 'La Stanza Segreta', img: stanza, alt: 'La Stanza Segreta con capi d’archivio su manichino',
    text: 'Se il negozio vi ha già stupito, non potete perdervi la vera chicca di LQ Milano: la nostra stanza segreta. Uno spazio esclusivo dove il vintage si fa esperienza. Qui troverete capi unici acquistabili, selezionati con cura e passione, accanto a una preziosa selezione d’archivio di brand di lusso e capi appartenuti a attrici e artiste, non in vendita ma disponibili per il noleggio a professionisti del cinema, del teatro e della fotografia.',
    tag: 'Archivio: solo noleggio professionale, non in vendita',
  },
];

import {
  siDiscord, siReddit, siYoutube, siX, siInstagram, siFacebook, siTiktok,
  siTwitch, siNetflix, siSpotify, siWhatsapp, siTelegram, siSnapchat, siPinterest,
  siGithub, siStackoverflow, siMedium, siSteam, siRoblox, siGoogle, siXiaohongshu,
  siZoom, siNotion, siOverleaf, siWikipedia, siQuora, siEbay, siEtsy,
  siTumblr, siVimeo, siDailymotion, siCnn, siZillow, siAirbnb, siUber,
} from 'simple-icons';

export interface BrandIconData {
  path: string;
  hex: string;
  title: string;
}

// A handful of brands were withdrawn from simple-icons (v15+). We embed their
// authentic logo paths here so they keep rendering.
const STATIC_BRANDS: Record<string, BrandIconData> = {
  twitter: {
    hex: '1D9BF0',
    title: 'Twitter',
    path: 'M21.543 7.104c.015.211.015.423.015.636 0 6.507-4.954 14.01-14.01 14.01v-.003A13.94 13.94 0 0 1 0 19.539a9.88 9.88 0 0 0 7.287-2.041 4.93 4.93 0 0 1-4.6-3.42 4.916 4.916 0 0 0 2.223-.084A4.926 4.926 0 0 1 .96 9.167v-.062a4.887 4.887 0 0 0 2.235.616A4.928 4.928 0 0 1 1.67 3.148 13.98 13.98 0 0 0 11.82 8.292a4.929 4.929 0 0 1 8.39-4.49 9.868 9.868 0 0 0 3.128-1.196 4.941 4.941 0 0 1-2.165 2.724A9.828 9.828 0 0 0 24 4.555a10.019 10.019 0 0 1-2.457 2.549z',
  },
  slack: {
    hex: '4A154B',
    title: 'Slack',
    path: 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z',
  },
  minecraft: {
    hex: '62B47A',
    title: 'Minecraft',
    path: 'M23.7397 10.0058l-2.4424.0023-.076.1198-.03-.1175h-2.4586l-.0599.136-.023-.136-2.4793.0023-.0438.1613-.0161-.1613-2.5023.0023-.023.265-.007-.265-2.5184.0046-.0092.242-.0254-.242-2.4954.0023-.016.1567-.0439-.1567H7.2673l-.0968.6705-.0553-.1382-.0254-.0024-.2096-.53-1.189.0024-.023.129-.0622-.129H4.431l-.03.1198-.0691-.1198-1.1659.0023-.136.523h-.3156l-.06.2282-.5506-.7512-1.1337.0023L0 13.0403l1.03.954h1.1244l.1774-.6706.0876.0968h.2995l.5.5737h1.1544l.023-.1082.0807.1082h1.1636l.0207-.1175.0737.1175h1.1751l.09-.629.3018.629h1.1889l.0138-.1451.0507.1451H11.03l.0093-.228.0276.228h2.4954l.023-.2511.0093.2511h1.2235l.0392-.175.0115.175h1.2097l.0506-.152.0139.152h1.1958l.0622-.1336.0185.1336h1.1843l.0714-.122.0208.122h1.175l.6798-.9677-.0323-.1544h.3756l.5346-.7396.4562 1.8594h1.152L24 13.0334l-.0184-.0737-.0738-.2535-.069-.2327s-.219-.712-.2466-.8065c-.0346-.1152-.0714-.2327-.1037-.3456l-.0046-.0184.4838-.583zm-2.325.1682h2.2005l.1567.493h-.6383l.0046.0162c.0254.1083.0554.2189.0853.3295.03.1129.0645.2258.0968.3433.0345.1152.069.235.106.3525.0368.1199.0737.2374.1083.3572.023.0737.0438.1451.0668.2189.023.0737.046.1497.0691.2235l.0692.228c.023.0761.0437.1522.0667.2282h-.9976l-.6268-2.2973h-.6405zm-.3548.0023l.1222.493h-1.295l.1175.56h1.3134l.136.553h-1.3342l.2466 1.182-.9954.0023-.5093-2.788zm-2.553.0023l.4816 2.788h-.9954l-.129-.8986h-.3733l.1221.8986h-.9954l-.3064-2.7857zm-2.5484.0023l.1037 1.0322h-.3272l.03.3111h.3272l.1451 1.4424h-.993l-.09-1.1751-.3686-.0092.076 1.1843h-.993l-.1037-2.7834zm-2.546.0023l.0138.493h-1.272l-.0299 1.719h1.3503l.016.5737h-2.364l.0945-2.7834zm-2.5438.0023l-.0208.493H9.56l-.0415.5692 1.3042.0023-.023.5369-1.3296.0023-.0437.6014 1.3456.0045-.0253.5738H8.387l.2926-2.7811zm-2.5392.0023l-.3226 2.781h-.9908l.1245-.8847-.3273-.0092.083-.5737-.3594-.007-.235 1.477H5.311l.5184-2.7811h.917l-.0806.5138.3157.0092-.076.5369.3548.0046L7.41 10.19zm-5.0346.0046h.9171l-.6475 2.7788h-.9884l.2972-1.1797H2.516l-.1543.5737h-.6406l.159-.5737h-.3595l-.3502 1.1797h-.97l.8917-2.7765h.8986l-.1475.5046.3134.0115L2 11.257h.6959l.1451-.5391h.318zm2.182.0046l-.546 2.7811h-.9885l.6175-2.7788zm12.1683.4217l.0391.3248-.341-.0023-.0437-.3202h-.4217l.0438.3525h.387l.0185.129h-.1936l.0715.5461h.2327l-.0184-.1843.3456-.0023.03.1866h.2373l-.083-.5414h-.1935l-.0162-.1314.3963-.0023-.0553-.3548zm-2.9286.0553l.0369.5737h.364l-.0438-.5737zm-1.1958 1.0046l.0184.5484-1.2166-.0023.0115-.4102h1.1774Z',
  },
  linkedin: {
    hex: '0A66C2',
    title: 'LinkedIn',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  microsoft: {
    hex: '5E5E5E',
    title: 'Microsoft',
    path: 'M0 0v11.408h11.408V0zm12.594 0v11.408H24V0zM0 12.594V24h11.408V12.594zm12.594 0V24H24V12.594z',
  },
  yahoo: {
    hex: '6001D2',
    title: 'Yahoo!',
    path: 'M18.86 1.56L14.27 11.87H19.4L24 1.56H18.86M0 6.71L5.15 18.27L3.3 22.44H7.83L14.69 6.71H10.19L7.39 13.44L4.62 6.71H0M15.62 12.87C13.95 12.87 12.71 14.12 12.71 15.58C12.71 17 13.91 18.19 15.5 18.19C17.18 18.19 18.43 16.96 18.43 15.5C18.43 14.03 17.23 12.87 15.62 12.87Z',
  },
  amazon: {
    hex: 'FF9900',
    title: 'Amazon',
    path: 'M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726a17.617 17.617 0 01-10.951-.577 17.88 17.88 0 01-5.43-3.35c-.1-.074-.151-.15-.151-.22 0-.047.021-.09.051-.13zm6.565-6.218c0-1.005.247-1.863.743-2.577.495-.71 1.17-1.25 2.04-1.615.796-.335 1.756-.575 2.912-.72.39-.046 1.033-.103 1.92-.174v-.37c0-.93-.105-1.558-.3-1.875-.302-.43-.78-.65-1.44-.65h-.182c-.48.046-.896.196-1.246.46-.35.27-.575.63-.675 1.096-.06.3-.206.465-.435.51l-2.52-.315c-.248-.06-.372-.18-.372-.39 0-.046.007-.09.022-.15.247-1.29.855-2.25 1.82-2.88.976-.616 2.1-.975 3.39-1.05h.54c1.65 0 2.957.434 3.888 1.29.135.15.27.3.405.48.12.165.224.314.283.45.075.134.15.33.195.57.06.254.105.42.135.51.03.104.062.3.076.615.01.313.02.493.02.553v5.28c0 .376.06.72.165 1.036.105.313.21.54.315.674l.51.674c.09.136.136.256.136.36 0 .12-.06.226-.18.314-1.2 1.05-1.86 1.62-1.963 1.71-.165.135-.375.15-.63.045a6.062 6.062 0 01-.526-.496l-.31-.347a9.391 9.391 0 01-.317-.42l-.3-.435c-.81.886-1.603 1.44-2.4 1.665-.494.15-1.093.227-1.83.227-1.11 0-2.04-.343-2.76-1.034-.72-.69-1.08-1.665-1.08-2.94l-.05-.076zm3.753-.438c0 .566.14 1.02.425 1.364.285.34.675.512 1.155.512.045 0 .106-.007.195-.02.09-.016.134-.023.166-.023.614-.16 1.08-.553 1.424-1.178.165-.28.285-.58.36-.91.09-.32.12-.59.135-.8.015-.195.015-.54.015-1.005v-.54c-.84 0-1.484.06-1.92.18-1.275.36-1.92 1.17-1.92 2.43l-.035-.02zm9.162 7.027c.03-.06.075-.11.132-.17.362-.243.714-.41 1.05-.5a8.094 8.094 0 011.612-.24c.14-.012.28 0 .41.03.65.06 1.05.168 1.172.33.063.09.099.228.099.39v.15c0 .51-.149 1.11-.424 1.8-.278.69-.664 1.248-1.156 1.68-.073.06-.14.09-.197.09-.03 0-.06 0-.09-.012-.09-.044-.107-.12-.064-.24.54-1.26.806-2.143.806-2.64 0-.15-.03-.27-.087-.344-.145-.166-.55-.257-1.224-.257-.243 0-.533.016-.87.046-.363.045-.7.09-1 .135-.09 0-.148-.014-.18-.044-.03-.03-.036-.047-.02-.077 0-.017.006-.03.02-.063v-.06z',
  },
  bbc: {
    hex: '000000',
    title: 'BBC',
    path: 'M24 8.57v6.8572h-6.8571V8.57H24Zm-8.5714 0v6.8571H8.5714V8.57h6.8572Zm-8.5715 0v6.8571H0V8.57h6.8571zm14.0292 1.459c-.3086 0-.5871.0458-.8357.1374-.2487.0917-.462.2239-.6397.3966-.178.1727-.314.3798-.4084.6213-.0944.2415-.1415.512-.1415.8116 0 .3067.0454.5826.1361.8275.0907.245.2214.4521.392.6213.1706.1692.3792.2988.626.3887.2469.0899.5245.1348.833.1348.2323 0 .4538-.0256.6643-.0767.2105-.051.3956-.1207.5553-.2088v-.735c-.3376.208-.706.312-1.1052.312-.2613 0-.4837-.0494-.667-.148-.1832-.0987-.323-.2424-.4191-.431-.0963-.1886-.1443-.4168-.1443-.6848 0-.2678.0498-.4952.1497-.682a1.0142 1.0142 0 0 1 .4301-.4284c.1869-.0986.4129-.148.6778-.148.1924 0 .3757.0256.5499.0766a1.779 1.779 0 0 1 .4846.2247v-.7508a2.2548 2.2548 0 0 0-.5309-.193c-.1905-.044-.3929-.066-.607-.066Zm-8.9387.041H10.5v3.8571h1.5367c.3042 0 .5647-.0449.7815-.1348.2168-.0899.3837-.2176.5009-.383.117-.1654.1756-.3633.1756-.5934 0-.2338-.0602-.4325-.1809-.5962-.1206-.1636-.2946-.2832-.5218-.3587.1643-.079.2884-.1861.3723-.321.084-.1348.126-.294.126-.4774 0-.32-.1172-.5655-.3515-.7364-.2343-.1707-.5647-.2562-.9912-.2562Zm-8.5715 0H1.9286v3.8571h1.5367c.3042 0 .5646-.0449.7815-.1348.2167-.0899.3837-.2176.5008-.383.1171-.1654.1757-.3633.1757-.5934 0-.2338-.0603-.4325-.181-.5962-.1205-.1636-.2945-.2832-.5218-.3587.1643-.079.2885-.1861.3724-.321.084-.1348.1259-.294.1259-.4774 0-.32-.1172-.5655-.3514-.7364-.2343-.1707-.5647-.2562-.9913-.2562Zm8.5977 2.1902c.479 0 .7185.1763.7185.5287 0 .1654-.063.2922-.1888.3803-.1259.0882-.306.1322-.5402.1322h-.6818v-1.0412h.6923Zm-8.5715 0c.479 0 .7186.1763.7186.5287 0 .1654-.063.2922-.1888.3803-.126.0882-.306.1322-.5402.1322H2.71v-1.0412h.6922zm8.4718-1.5644c.416 0 .6242.1529.6242.4585 0 .1583-.0534.2815-.16.3695-.1067.0882-.2614.1322-.4642.1322h-.5926v-.9602h.5926Zm-8.5714 0c.416 0 .6241.1529.6241.4585 0 .1583-.0533.2815-.16.3695-.1066.0882-.2613.1322-.4641.1322H2.71v-.9602h.5927Z',
  },
};

const BRANDS: Record<string, BrandIconData> = {
  discord: { path: siDiscord.path, hex: siDiscord.hex, title: siDiscord.title },
  reddit: { path: siReddit.path, hex: siReddit.hex, title: siReddit.title },
  youtube: { path: siYoutube.path, hex: siYoutube.hex, title: siYoutube.title },
  x: { path: siX.path, hex: siX.hex, title: siX.title },
  instagram: { path: siInstagram.path, hex: siInstagram.hex, title: siInstagram.title },
  facebook: { path: siFacebook.path, hex: siFacebook.hex, title: siFacebook.title },
  tiktok: { path: siTiktok.path, hex: siTiktok.hex, title: siTiktok.title },
  twitch: { path: siTwitch.path, hex: siTwitch.hex, title: siTwitch.title },
  netflix: { path: siNetflix.path, hex: siNetflix.hex, title: siNetflix.title },
  spotify: { path: siSpotify.path, hex: siSpotify.hex, title: siSpotify.title },
  whatsapp: { path: siWhatsapp.path, hex: siWhatsapp.hex, title: siWhatsapp.title },
  telegram: { path: siTelegram.path, hex: siTelegram.hex, title: siTelegram.title },
  snapchat: { path: siSnapchat.path, hex: siSnapchat.hex, title: siSnapchat.title },
  pinterest: { path: siPinterest.path, hex: siPinterest.hex, title: siPinterest.title },
  github: { path: siGithub.path, hex: siGithub.hex, title: siGithub.title },
  stackoverflow: { path: siStackoverflow.path, hex: siStackoverflow.hex, title: siStackoverflow.title },
  medium: { path: siMedium.path, hex: siMedium.hex, title: siMedium.title },
  steam: { path: siSteam.path, hex: siSteam.hex, title: siSteam.title },
  roblox: { path: siRoblox.path, hex: siRoblox.hex, title: siRoblox.title },
  google: { path: siGoogle.path, hex: siGoogle.hex, title: siGoogle.title },
  xiaohongshu: { path: siXiaohongshu.path, hex: siXiaohongshu.hex, title: siXiaohongshu.title },
  zoom: { path: siZoom.path, hex: siZoom.hex, title: siZoom.title },
  notion: { path: siNotion.path, hex: siNotion.hex, title: siNotion.title },
  overleaf: { path: siOverleaf.path, hex: siOverleaf.hex, title: siOverleaf.title },
  wikipedia: { path: siWikipedia.path, hex: siWikipedia.hex, title: siWikipedia.title },
  quora: { path: siQuora.path, hex: siQuora.hex, title: siQuora.title },
  ebay: { path: siEbay.path, hex: siEbay.hex, title: siEbay.title },
  etsy: { path: siEtsy.path, hex: siEtsy.hex, title: siEtsy.title },
  tumblr: { path: siTumblr.path, hex: siTumblr.hex, title: siTumblr.title },
  vimeo: { path: siVimeo.path, hex: siVimeo.hex, title: siVimeo.title },
  dailymotion: { path: siDailymotion.path, hex: siDailymotion.hex, title: siDailymotion.title },
  cnn: { path: siCnn.path, hex: siCnn.hex, title: siCnn.title },
  zillow: { path: siZillow.path, hex: siZillow.hex, title: siZillow.title },
  airbnb: { path: siAirbnb.path, hex: siAirbnb.hex, title: siAirbnb.title },
  uber: { path: siUber.path, hex: siUber.hex, title: siUber.title },
  ...STATIC_BRANDS,
};

// Map both site domains and app names to a brand slug.
const MAPPINGS: Array<[string, string]> = [
  ['discord.com', 'discord'], ['discord', 'discord'],
  ['reddit.com', 'reddit'], ['reddit', 'reddit'],
  ['youtube.com', 'youtube'], ['youtube', 'youtube'],
  ['twitter.com', 'twitter'], ['twitter', 'twitter'],
  ['x.com', 'x'],
  ['instagram.com', 'instagram'], ['instagram', 'instagram'],
  ['facebook.com', 'facebook'], ['facebook', 'facebook'],
  ['tiktok.com', 'tiktok'], ['tiktok', 'tiktok'],
  ['twitch.tv', 'twitch'], ['twitch', 'twitch'],
  ['netflix.com', 'netflix'], ['netflix', 'netflix'],
  ['spotify.com', 'spotify'], ['spotify', 'spotify'],
  ['whatsapp.com', 'whatsapp'], ['whatsapp', 'whatsapp'],
  ['whatsapp.net', 'whatsapp'],
  ['telegram.org', 'telegram'], ['telegram', 'telegram'],
  ['t.me', 'telegram'],
  ['snapchat.com', 'snapchat'], ['snapchat', 'snapchat'],
  ['pinterest.com', 'pinterest'], ['pinterest', 'pinterest'],
  ['linkedin.com', 'linkedin'], ['linkedin', 'linkedin'],
  ['github.com', 'github'], ['github', 'github'],
  ['stackoverflow.com', 'stackoverflow'], ['stackoverflow', 'stackoverflow'],
  ['medium.com', 'medium'], ['medium', 'medium'],
  ['slack.com', 'slack'], ['slack', 'slack'],
  ['minecraft.net', 'minecraft'], ['minecraft', 'minecraft'],
  ['steampowered.com', 'steam'], ['steam', 'steam'],
  ['steamcommunity.com', 'steam'],
  ['roblox.com', 'roblox'], ['roblox', 'roblox'],
  ['google.com', 'google'], ['google', 'google'],
  ['xiaohongshu.com', 'xiaohongshu'],
  ['microsoft.com', 'microsoft'],
  ['yahoo.com', 'yahoo'],
  ['zoom.us', 'zoom'], ['zoom', 'zoom'],
  ['notion.so', 'notion'], ['notion', 'notion'],
  ['wikipedia.org', 'wikipedia'], ['wikipedia', 'wikipedia'],
  ['quora.com', 'quora'], ['quora', 'quora'],
  ['ebay.com', 'ebay'], ['ebay', 'ebay'],
  ['amazon.com', 'amazon'], ['amazon', 'amazon'],
  ['etsy.com', 'etsy'], ['etsy', 'etsy'],
  ['tumblr.com', 'tumblr'], ['tumblr', 'tumblr'],
  ['vimeo.com', 'vimeo'], ['vimeo', 'vimeo'],
  ['dailymotion.com', 'dailymotion'], ['dailymotion', 'dailymotion'],
  ['bbc.com', 'bbc'], ['bbc.co.uk', 'bbc'],
  ['cnn.com', 'cnn'],
  ['zillow.com', 'zillow'],
  ['airbnb.com', 'airbnb'], ['airbnb', 'airbnb'],
  ['uber.com', 'uber'],
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

export function getBrandIcon(nameOrDomain: string): BrandIconData | null {
  const key = normalize(nameOrDomain);
  if (!key) return null;

  // Direct lookup on raw value first
  const direct = BRANDS[key];
  if (direct) return direct;

  // Mappings (domain → slug, app name → slug)
  for (const [match, slug] of MAPPINGS) {
    if (key === match || key === normalize(match)) {
      const brand = BRANDS[slug];
      if (brand) return brand;
    }
  }

  // Loose contains-match for app names that come with extras like "– stable"
  for (const [match, slug] of MAPPINGS) {
    if (key.includes(match) && BRANDS[slug]) {
      return BRANDS[slug];
    }
  }

  // Try to find a brand by the slug itself (typo/idempotent path)
  return BRANDS[key.replace(/[\s.-]+/g, '')] || null;
}
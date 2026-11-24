// public/delhi-hi.html, the Delhi 2027 page in Hindi (13 Nov 2026), made from public/index.html
// (the Delhi page, which became the home page on 24 Nov 2026; it was public/delhi.html)
// so the design, the effects, the forms and the prices stay the English page's own.
// Every sentence is swapped by an exact [English, Hindi] pair that must be found the number
// of times given: when the English page changes, this stops and names the sentence, and
// the pair is updated. Links still go to the English pages and forms.
//   node scripts/gen-delhi-hi.mjs           write public/delhi-hi.html
//   node scripts/gen-delhi-hi.mjs --check   fail if public/delhi-hi.html is not up to date
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('public/index.html', ROOT);
const OUT = new URL('public/delhi-hi.html', ROOT);
const en = readFileSync(SRC, 'utf8');
const crlf = en.includes('\r\n');
let s = en.replace(/\r\n/g, '\n');
const problems = [];
// [english, hindi, times]: times is how often the English must appear (default 1).
function swap(a, b, times = 1) {
  const n = s.split(a).length - 1;
  if (n !== times) { problems.push(`found ${n} times, expected ${times}: ${a.slice(0, 90)}`); return; }
  s = s.split(a).join(b);
}

// ---- the head: Hindi title, description, link previews; no structured data (the English
// page carries the event's), and the two pages point at each other ----
const head = s.match(/<title>[\s\S]*?<\/script>/);
if (!head) problems.push('head: <title> ... first </script> not found');
else s = s.replace(head[0], `<title>भारत एआई इनोवेशन दिल्ली 2027 · 28–29 जुलाई, भारत मंडपम, नई दिल्ली</title>
    <meta name="description" content="भारत एआई इनोवेशन 28–29 जुलाई 2027 को भारत मंडपम, नई दिल्ली में: मुख्य वक्तव्य, पैनल चर्चाएँ, इनोवेशन टॉक्स और शोकेस, एआई वर्कशॉप, हैकथॉन, प्रदर्शनी और B2B नेटवर्किंग। पास, बूथ और पार्टनरशिप अभी उपलब्ध हैं।">
    <link rel="canonical" href="https://bharataiinnovation.com/delhi-hi">
    <link rel="alternate" hreflang="en" href="https://bharataiinnovation.com/">
    <link rel="alternate" hreflang="hi" href="https://bharataiinnovation.com/delhi-hi">
    <link rel="alternate" hreflang="x-default" href="https://bharataiinnovation.com/">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Bharat AI Innovation">
    <meta property="og:locale" content="hi_IN">
    <meta property="og:locale:alternate" content="en_IN">
    <meta property="og:url" content="https://bharataiinnovation.com/delhi-hi">
    <meta property="og:title" content="भारत एआई इनोवेशन दिल्ली 2027 · 28–29 जुलाई, भारत मंडपम">
    <meta property="og:description" content="भारत का B2B एआई सम्मेलन और प्रदर्शनी 28–29 जुलाई 2027 को भारत मंडपम, नई दिल्ली में। पास, बूथ और पार्टनरशिप अभी उपलब्ध हैं।">
    <meta property="og:image" content="https://bharataiinnovation.com/images/og/delhi.jpg">
    <meta property="og:image:secure_url" content="https://bharataiinnovation.com/images/og/delhi.jpg">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="भारत एआई इनोवेशन दिल्ली 2027, 28–29 जुलाई 2027, भारत मंडपम, नई दिल्ली">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="भारत एआई इनोवेशन दिल्ली 2027">
    <meta name="twitter:description" content="भारत का B2B एआई सम्मेलन और प्रदर्शनी 28–29 जुलाई 2027 को भारत मंडपम, नई दिल्ली में।">
    <meta name="twitter:image" content="https://bharataiinnovation.com/images/og/delhi.jpg">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
    <!-- Made by scripts/gen-delhi-hi.mjs from public/index.html. Do not edit by hand. -->`);
swap('<html lang="en">', '<html lang="hi">');
swap('    <style>\n', "    <style>\n    /* Hindi: Devanagari letters come from Mukta (fonts.css), the rest stays the site's own. */\n    :root { --font-body: 'Manrope', 'Mukta', sans-serif; --font-display: 'Bricolage Grotesque', 'Mukta', sans-serif; }\n    body { font-family: var(--font-body); }\n");
swap('<a href="#main-content" class="skip-link">Skip to main content</a>', '<a href="#main-content" class="skip-link">मुख्य सामग्री पर जाएँ</a>');

// ---- the menu (its links stay the English pages) ----
for (const [a, b] of [['Mumbai', 'मुंबई'], ['Conference', 'कॉन्फ्रेंस'], ['Exhibition', 'प्रदर्शनी'], ['Networking', 'नेटवर्किंग'], ['Partner', 'पार्टनर'], ['Govt', 'सरकार'], ['Workshops', 'वर्कशॉप'], ['AI Marketplace', 'एआई मार्केटप्लेस'], ['Campus Series', 'कैंपस सीरीज़'], ['Gallery', 'गैलरी'], ['AI Readiness', 'एआई रेडीनेस'], ['Contact', 'संपर्क']]) {
  swap(`class="nav-link">${a}</a>`, `class="nav-link">${b}</a>`);
}
swap('class="nav-link active">Home</a>', 'class="nav-link active">होम</a>');
swap('Get your pass', 'अपना पास लें', 4);

// ---- the hero ----
swap('<span>28–29 July 2027</span>', '<span>28–29 जुलाई 2027</span>');
swap('<span>Bharat Mandapam<span class="dl-wide">, New Delhi</span></span>', '<span>भारत मंडपम<span class="dl-wide">, नई दिल्ली</span></span>');
swap('<p class="dl-kicker">International AI Conference &amp; Exhibition</p>', '<p class="dl-kicker">अंतरराष्ट्रीय एआई कॉन्फ्रेंस और प्रदर्शनी</p>');
swap('India’s B2B platform for AI comes to the capital. Two days at Bharat Mandapam for government, enterprises, startups, academia and international delegations: the people using AI, and the companies building it.',
  'भारत का B2B एआई प्लेटफ़ॉर्म अब राजधानी में। भारत मंडपम में दो दिन, सरकार, उद्यमों, स्टार्टअप्स, शिक्षा जगत और अंतरराष्ट्रीय प्रतिनिधिमंडलों के लिए: जो एआई का उपयोग कर रहे हैं, और जो कंपनियाँ इसे बना रही हैं।');
swap('</i> Save the date</a>', '</i> कैलेंडर में जोड़ें</a>', 2);
swap('<a href="#booths">Apply for a booth</a> or <a href="#partner">become a partner</a>', '<a href="#booths">बूथ के लिए आवेदन करें</a> या <a href="#partner">पार्टनर बनें</a>');
swap('<a href="/delhi-hi" hreflang="hi" lang="hi">हिन्दी में पढ़ें</a>', '<a href="/" hreflang="en" lang="en">Read in English</a>');

// ---- the programme ----
swap('What is on in <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> में क्या होगा');
swap('The full Bharat AI Innovation format, for two days at Bharat Mandapam.', 'भारत मंडपम में दो दिन, भारत एआई इनोवेशन का पूरा कार्यक्रम।');
swap('<b>Innovation Talks &amp; Showcase</b><i class="by">By startups and corporates</i><span>Short talks on stage and a live look at what they have built.</span>',
  '<b>इनोवेशन टॉक्स और शोकेस</b><i class="by">स्टार्टअप्स और कॉर्पोरेट्स द्वारा</i><span>मंच पर छोटी वार्ताएँ और उनके बनाए समाधानों की लाइव झलक।</span>');
swap('<b>Innovation Talks &amp; Showcase</b><i class="by">By government departments, ministries and state governments</i><span>How government teams are using AI, shown on stage.</span>',
  '<b>इनोवेशन टॉक्स और शोकेस</b><i class="by">सरकारी विभागों, मंत्रालयों और राज्य सरकारों द्वारा</i><span>सरकारी टीमें एआई का उपयोग कैसे कर रही हैं, मंच पर।</span>');
for (const [a, b] of [
  ['<b>Keynotes</b><span>Where AI in India is going.</span>', '<b>मुख्य वक्तव्य</b><span>भारत में एआई किस दिशा में जा रहा है।</span>'],
  ['<b>Panel discussions</b><span>What worked, and what did not.</span>', '<b>पैनल चर्चाएँ</b><span>क्या काम आया, और क्या नहीं।</span>'],
  ['<b>AI workshops</b><span>Hands-on, led by practitioners.</span>', '<b>एआई वर्कशॉप</b><span>व्यावहारिक, अनुभवी विशेषज्ञों के साथ।</span>'],
  ['<b>Hackathons</b><span>Teams build working AI, fast.</span>', '<b>हैकथॉन</b><span>टीमें तेज़ी से काम करने वाला एआई बनाती हैं।</span>'],
  ['<b>Closed-door roundtables</b><span>Small rooms for senior leaders.</span>', '<b>बंद कमरे की गोलमेज़ बैठकें</b><span>वरिष्ठ नेतृत्व के लिए छोटे सत्र।</span>'],
  ['<b>Exhibition</b><span>AI products, live, for buyers.</span>', '<b>प्रदर्शनी</b><span>ख़रीदारों के लिए एआई उत्पाद, लाइव।</span>'],
  ['<b>Cross-border dialogue</b><span>India and the world on AI.</span>', '<b>अंतरराष्ट्रीय संवाद</b><span>एआई पर भारत और दुनिया।</span>'],
  ['<b>B2B networking</b><span>Book meetings before you arrive.</span>', '<b>B2B नेटवर्किंग</b><span>आने से पहले ही मीटिंग तय करें।</span>'],
  ['<li class="lead">Also:</li>', '<li class="lead">यह भी:</li>'],
  ['<li>CXO AI Leadership Panels</li>', '<li>सीएक्सओ एआई लीडरशिप पैनल</li>'],
  ['<li>Startup Pitch</li>', '<li>स्टार्टअप पिच</li>'],
  ['<li>Bharat AI Leaders’ Evening</li>', '<li>भारत एआई लीडर्स इवनिंग</li>'],
  ['<li>Private boardrooms</li>', '<li>निजी बोर्डरूम</li>'],
  ['<li>AI Marketplace</li>', '<li>एआई मार्केटप्लेस</li>'],
  ['<li>Bharat AI Connect app</li>', '<li>भारत एआई कनेक्ट ऐप</li>'],
  ['Photos from Bharat AI Innovation in Mumbai, November 2026. The workshop, hackathon and cross-border photos are from Data Science Congress, the predecessor to Bharat AI Innovation. The roundtable photo is a World Trade Center Mumbai boardroom.', 'तस्वीरें भारत एआई इनोवेशन मुंबई, नवंबर 2026 की हैं। वर्कशॉप, हैकथॉन और अंतरराष्ट्रीय संवाद की तस्वीरें डेटा साइंस कांग्रेस (भारत एआई इनोवेशन का पहले का रूप) की हैं। गोलमेज़ बैठक की तस्वीर वर्ल्ड ट्रेड सेंटर मुंबई के एक बोर्डरूम की है।'],
]) swap(a, b);

// ---- the vision and the plan (24 Nov 2026) ----
swap('Our vision: AI for a <span class="accent">Viksit Bharat</span>', 'हमारा विज़न: <span class="accent">विकसित भारत</span> के लिए एआई');
swap('India’s ministries, public sector companies and leading enterprises make their AI decisions in Delhi. Bharat AI Innovation brings together the people who buy AI, the people who build it and the people who write its rules, so that good ideas become real projects across India.',
  'भारत के मंत्रालय, सार्वजनिक क्षेत्र की कंपनियाँ और प्रमुख उद्यम अपने एआई फ़ैसले दिल्ली में लेते हैं। भारत एआई इनोवेशन एआई ख़रीदने वालों, उसे बनाने वालों और उसके नियम लिखने वालों को एक साथ लाता है, ताकि अच्छे विचार पूरे भारत में असली परियोजनाएँ बनें।');
swap('<p class="dl-plan-head">Our plan for the two days</p>', '<p class="dl-plan-head">दो दिनों की हमारी योजना</p>');
for (const [a, b] of [
  ['<b>Show what works</b><span>Startups, companies and government teams show AI already in use, on stage and on the exhibition floor.</span>', '<b>जो काम करता है, वह दिखाएँ</b><span>स्टार्टअप्स, कंपनियाँ और सरकारी टीमें मंच पर और प्रदर्शनी में वह एआई दिखाती हैं जो पहले से उपयोग में है।</span>'],
  ['<b>Decide together</b><span>Leaders from government and industry meet in panels and closed-door roundtables to agree on what comes next.</span>', '<b>मिलकर तय करें</b><span>सरकार और उद्योग के लीडर पैनल और बंद कमरे की गोलमेज़ बैठकों में आगे की दिशा तय करते हैं।</span>'],
  ['<b>Do business</b><span>Buyers meet the companies building AI, in meetings booked before the event and on the floor.</span>', '<b>व्यापार करें</b><span>ख़रीदार एआई बनाने वाली कंपनियों से मिलते हैं, पहले से तय मीटिंग में और प्रदर्शनी में।</span>'],
  ['<b>Build skills</b><span>Hands-on workshops and hackathons for working teams, faculty and students.</span>', '<b>कौशल बढ़ाएँ</b><span>कामकाजी टीमों, शिक्षकों और छात्रों के लिए व्यावहारिक वर्कशॉप और हैकथॉन।</span>'],
]) swap(a, b);

// ---- the Government AI Showcase ----
swap('Government <span class="accent">AI Showcase</span>', 'सरकारी <span class="accent">एआई शोकेस</span>');
swap('Central ministries, state governments and their departments show the AI work they have already done: to improve governance, to make citizens’ lives better and to deliver public services faster and more simply.',
  'केंद्रीय मंत्रालय, राज्य सरकारें और उनके विभाग वह एआई काम दिखाते हैं जो वे कर चुके हैं: शासन बेहतर बनाने, नागरिकों का जीवन आसान बनाने और सार्वजनिक सेवाएँ तेज़ और सरल बनाने के लिए।');
for (const [a, b] of [
  ['<li><b>On stage.</b> Innovation Talks &amp; Showcase by ministries, departments and state governments.</li>', '<li><b>मंच पर।</b> मंत्रालयों, विभागों और राज्य सरकारों के इनोवेशन टॉक्स और शोकेस।</li>'],
  ['<li><b>On the floor.</b> Pavilions for central and state governments, with live demonstrations.</li>', '<li><b>प्रदर्शनी में।</b> केंद्र और राज्य सरकारों के पवेलियन, लाइव प्रदर्शन के साथ।</li>'],
  ['<li><b>In the room.</b> Closed-door roundtables where officials and industry plan what to build next.</li>', '<li><b>बैठकों में।</b> बंद कमरे की गोलमेज़ बैठकें, जहाँ अधिकारी और उद्योग तय करते हैं कि आगे क्या बनाना है।</li>'],
  ['<li><b>Across states.</b> See what has worked in one state, and take it to another.</li>', '<li><b>राज्यों के बीच।</b> देखें कि एक राज्य में क्या सफल रहा, और उसे दूसरे राज्य तक ले जाएँ।</li>'],
  ['Showcase your initiative <i', 'अपनी पहल दिखाएँ <i'],
]) swap(a, b);

// ---- India and the world ----
swap('India and <span class="accent">the world</span>', 'भारत और <span class="accent">दुनिया</span>');
swap('Embassies, high commissions, trade offices and delegations from other countries are invited to take part: to meet India’s AI buyers and builders, and to talk to government.',
  'दूतावासों, उच्चायोगों, व्यापार कार्यालयों और दूसरे देशों के प्रतिनिधिमंडलों को भाग लेने का निमंत्रण है: भारत के एआई ख़रीदारों और निर्माताओं से मिलने, और सरकार से बात करने के लिए।');
for (const [a, b] of [
  ['<li><b>Country pavilions.</b> Show your country’s AI companies on the exhibition floor.</li>', '<li><b>देश के पवेलियन।</b> प्रदर्शनी में अपने देश की एआई कंपनियाँ दिखाएँ।</li>'],
  ['<li><b>Delegations.</b> Bring a business or government delegation, with meetings booked before you arrive.</li>', '<li><b>प्रतिनिधिमंडल।</b> व्यापार या सरकारी प्रतिनिधिमंडल लाएँ, आने से पहले तय मीटिंग के साथ।</li>'],
  ['<li><b>Cross-border dialogue.</b> Speak on stage about AI cooperation with India.</li>', '<li><b>अंतरराष्ट्रीय संवाद।</b> भारत के साथ एआई सहयोग पर मंच से बोलें।</li>'],
  ['<li><b>Roundtables.</b> Closed-door, between two countries or several, on a theme you set.</li>', '<li><b>गोलमेज़ बैठकें।</b> बंद कमरे में, दो या कई देशों के बीच, आपके तय किए विषय पर।</li>'],
  ['Bring a delegation <i', 'प्रतिनिधिमंडल लाएँ <i'],
  ['>Visa letter</a>', '>वीज़ा पत्र</a>'],
]) swap(a, b);

// ---- take part ----
swap('Take part in <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> में भाग लें');
swap('For government, companies, startups, small businesses and campuses.', 'सरकार, कंपनियों, स्टार्टअप्स, छोटे व्यवसायों और शिक्षण संस्थानों के लिए।');
for (const [a, b] of [
  ['<h3>Corporates</h3>', '<h3>कॉर्पोरेट</h3>'],
  ['Enterprises, and the companies that bring them AI.', 'उद्यम, और वे कंपनियाँ जो उन तक एआई पहुँचाती हैं।'],
  ['<li>Speak on a CXO panel or host a roundtable</li>', '<li>सीएक्सओ पैनल में बोलें या गोलमेज़ बैठक की मेज़बानी करें</li>'],
  ['<li>Show your AI products to buyers</li>', '<li>ख़रीदारों को अपने एआई उत्पाद दिखाएँ</li>'],
  ['<li>Partner with the event</li>', '<li>आयोजन के पार्टनर बनें</li>'],
  ['>Partner with us</a>', '>हमारे पार्टनर बनें</a>'],
  ['<h3>Government</h3>', '<h3>सरकार</h3>'],
  ['Central ministries, state governments and their departments.', 'केंद्रीय मंत्रालय, राज्य सरकारें और उनके विभाग।'],
  ['<li>Show your AI work on stage</li>', '<li>मंच पर अपना एआई काम दिखाएँ</li>'],
  ['<li>A pavilion with live demonstrations</li>', '<li>लाइव प्रदर्शन के साथ एक पवेलियन</li>'],
  ['<li>Closed-door roundtables with industry</li>', '<li>उद्योग के साथ बंद कमरे में गोलमेज़ बैठकें</li>'],
  ['>Nominate your initiative</a>', '>अपनी पहल नामांकित करें</a>'],
  ['<h3>Startups</h3>', '<h3>स्टार्टअप्स</h3>'],
  ['Startups building AI products.', 'एआई उत्पाद बनाने वाले स्टार्टअप्स।'],
  ['<li>A Startup Pod with an Innovation Talk</li>', '<li>इनोवेशन टॉक के साथ एक स्टार्टअप पॉड</li>'],
  ['<li>Startup Pitch on stage</li>', '<li>मंच पर स्टार्टअप पिच</li>'],
  ['<li>Meet enterprise and government buyers</li>', '<li>उद्यमों और सरकार के ख़रीदारों से मिलें</li>'],
  ['>Apply for a Startup Pod</a>', '>स्टार्टअप पॉड के लिए आवेदन करें</a>'],
  ['<h3>MSMEs</h3>', '<h3>एमएसएमई</h3>'],
  ['Small and medium businesses ready to use AI.', 'एआई अपनाने को तैयार छोटे और मध्यम व्यवसाय।'],
  ['<li>See AI tools you can use now</li>', '<li>ऐसे एआई टूल देखें जिन्हें आप अभी उपयोग कर सकते हैं</li>'],
  ['<li>Hands-on workshops for your team</li>', '<li>आपकी टीम के लिए व्यावहारिक वर्कशॉप</li>'],
  ['<li>Meet vendors in booked meetings</li>', '<li>तय मीटिंग में वेंडरों से मिलें</li>'],
  ['<h3>Academia</h3>', '<h3>शिक्षा जगत</h3>'],
  ['Universities, colleges, faculty and students.', 'विश्वविद्यालय, कॉलेज, शिक्षक और छात्र।'],
  ['<li>An Academic Pass for students and faculty</li>', '<li>छात्रों और शिक्षकों के लिए एकेडमिक पास</li>'],
  ['<li>Hackathons and workshops</li>', '<li>हैकथॉन और वर्कशॉप</li>'],
  ['<li>Meet the companies that use and build AI</li>', '<li>एआई का उपयोग करने और उसे बनाने वाली कंपनियों से मिलें</li>'],
  ['>Get an Academic Pass</a>', '>एकेडमिक पास लें</a>'],
]) swap(a, b);

// ---- partners: what can be sponsored (the prices are on /partner#delhi) ----
swap('Partner with us in <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> में हमारे पार्टनर बनें');
swap('Put your brand in front of the people who buy AI, build it and write its rules, in the capital.', 'अपने ब्रांड को राजधानी में उन लोगों के सामने रखें जो एआई ख़रीदते हैं, बनाते हैं और उसके नियम लिखते हैं।');
for (const [a, b] of [
  ['<li>Title Partner</li>', '<li>टाइटल पार्टनर</li>'],
  ['<li>Powered Partner</li>', '<li>पावर्ड पार्टनर</li>'],
  ['<li>Knowledge Partner</li>', '<li>नॉलेज पार्टनर</li>'],
  ['<li>Associate Partner</li>', '<li>एसोसिएट पार्टनर</li>'],
  ['<li>Innovation Partner</li>', '<li>इनोवेशन पार्टनर</li>'],
  ['<li>AI Leadership Panel</li>', '<li>एआई लीडरशिप पैनल</li>'],
  ['<li>Leaders Round Table</li>', '<li>लीडर्स राउंड टेबल</li>'],
  ['<li>Bharat AI Leaders’ Evening Partner</li>', '<li>भारत एआई लीडर्स इवनिंग पार्टनर</li>'],
  ['<li>Networking Lunch</li>', '<li>नेटवर्किंग लंच</li>'],
  ['<li>Lanyard and bag</li>', '<li>लैन्यार्ड और बैग</li>'],
  ['<li>Custom activation</li>', '<li>कस्टम एक्टिवेशन</li>'],
  ['See all partnerships <i', 'सभी पार्टनरशिप देखें <i'],
  ['>Talk to our team</a>', '>हमारी टीम से बात करें</a>'],
]) swap(a, b);

// ---- booths: the kinds of booth (the sizes and prices are on /exhibition#delhi) ----
swap('Exhibit in <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> में प्रदर्शन करें');
swap('Show your AI to the people who come to buy it. We will publish the floor plan later.', 'अपना एआई उन लोगों को दिखाएँ जो उसे ख़रीदने आते हैं। फ़्लोर प्लान बाद में प्रकाशित होगा।');
swap('Tell us what you will show. We review every application so the floor stays relevant for the people who come to buy. We reply within 2 working days. If approved, our team confirms your place and the next step for booking your booth.',
  'बताइए आप क्या दिखाएँगे। हम हर आवेदन की समीक्षा करते हैं, ताकि प्रदर्शनी उन लोगों के काम की रहे जो ख़रीदने आते हैं। हम 2 कार्यदिवसों में जवाब देते हैं। स्वीकृति मिलने पर हमारी टीम आपकी जगह और बूथ बुकिंग का अगला कदम बताएगी।');
swap('A booth at Bharat AI Innovation in Mumbai, November 2026.', 'भारत एआई इनोवेशन मुंबई (नवंबर 2026) का एक बूथ।');
for (const [a, b] of [
  ['<li>Startup Pod</li>', '<li>स्टार्टअप पॉड</li>'],
  ['<li>Explorer Booth</li>', '<li>एक्सप्लोरर बूथ</li>'],
  ['<li>Innovator Booth</li>', '<li>इनोवेटर बूथ</li>'],
  ['<li>Enterprise Booth</li>', '<li>एंटरप्राइज़ बूथ</li>'],
  ['<li>Accelerator Booth</li>', '<li>एक्सेलरेटर बूथ</li>'],
  ['<li>Flagship Pavilion</li>', '<li>फ़्लैगशिप पवेलियन</li>'],
  ['<li>Mega Pavilion</li>', '<li>मेगा पवेलियन</li>'],
  ['Apply for a booth <i', 'बूथ के लिए आवेदन करें <i'],
  ['>See all booths</a>', '>सभी बूथ देखें</a>'],
]) swap(a, b);

// ---- passes: on /delhi-register only (24 Nov 2026) ----

// ---- the venue ----
swap('Bharat Mandapam, <span class="accent">New Delhi</span>', 'भारत मंडपम, <span class="accent">नई दिल्ली</span>');
swap('The international convention and exhibition centre at Pragati Maidan, in the heart of the capital.', 'प्रगति मैदान स्थित अंतरराष्ट्रीय सम्मेलन और प्रदर्शनी केंद्र, राजधानी के बीचोंबीच।');
swap('<li>Hosted the G20 Leaders’ Summit in September 2023</li>', '<li>सितंबर 2023 में G20 लीडर्स समिट की मेज़बानी की</li>');
swap('<li>Conference halls and exhibition space in one complex</li>', '<li>एक ही परिसर में सम्मेलन हॉल और प्रदर्शनी स्थल</li>');
swap('<li>A bronze Nataraja stands at its entrance</li>', '<li>प्रवेश द्वार पर कांस्य की नटराज प्रतिमा</li>');
swap('Get directions <i', 'रास्ता देखें <i');

// ---- the free pass and enquiry form ----
swap('<h2 id="dl-form-title">Get your <span class="accent">free pass</span></h2>', '<h2 id="dl-form-title">अपना <span class="accent">मुफ़्त पास</span> लें</h2>');
swap('<p id="dl-form-text">Exhibition only, entry by time slot. Register to join the waitlist.</p>', '<p id="dl-form-text">केवल प्रदर्शनी, तय समय-स्लॉट में प्रवेश। प्रतीक्षा सूची में शामिल होने के लिए रजिस्टर करें।</p>');
swap('<legend>I want to</legend>', '<legend>आप क्या करना चाहते हैं?</legend>');
swap('value="attend" checked><span>Attend</span>', 'value="attend" checked><span>भाग लेना</span>');
swap('value="exhibit"><span>Exhibit</span>', 'value="exhibit"><span>प्रदर्शन</span>');
swap('value="sponsor"><span>Sponsor</span>', 'value="sponsor"><span>स्पॉन्सर</span>');
swap('value="speak"><span>Speak</span>', 'value="speak"><span>वक्ता</span>');
swap('<label for="dl-name">Your name</label>', '<label for="dl-name">आपका नाम</label>');
swap('<label for="dl-email">Email</label>', '<label for="dl-email">ईमेल</label>');
swap('<label for="dl-phone">Mobile <span', '<label for="dl-phone">मोबाइल <span');
swap('<span>Send me updates on WhatsApp (reply STOP any time)</span>', '<span>मुझे WhatsApp पर अपडेट भेजें (कभी भी STOP लिखकर बंद करें)</span>');
swap('<label for="dl-org">Organisation <span', '<label for="dl-org">संस्था <span');
swap('<label for="dl-job">Designation</label>', '<label for="dl-job">पद</label>');
swap('<label for="dl-city">City</label>', '<label for="dl-city">शहर</label>');
swap('<label for="dl-website">Leave this empty</label>', '<label for="dl-website">इसे खाली छोड़ें</label>');
swap('Register free <i', 'मुफ़्त रजिस्टर करें <i', 2);
swap('We only email you about Delhi. <a href="/privacy">Privacy policy</a>', 'हम आपको सिर्फ़ दिल्ली आयोजन के बारे में ईमेल करेंगे। <a href="/privacy">गोपनीयता नीति</a>');
swap('<h3 id="dl-done-title">You are waitlisted</h3>', '<h3 id="dl-done-title">आप प्रतीक्षा सूची में हैं</h3>');
// The form's own messages, in its script.
for (const [a, b] of [
  ["'You chose: '", "'आपने चुना: '"],
  ["'Send <i class=\"fas fa-arrow-right\" aria-hidden=\"true\"></i>'", "'भेजें <i class=\"fas fa-arrow-right\" aria-hidden=\"true\"></i>'"],
  ["(i === 'speak' ? '(optional)' : '(we will call you)')", "(i === 'speak' ? '(वैकल्पिक)' : '(हम आपको कॉल करेंगे)')"],
  ["orgHint.textContent = pass ? '' : '(optional)';", "orgHint.textContent = pass ? '' : '(वैकल्पिक)';"],
  ["'Get your <span class=\"accent\">free pass</span>' : 'Talk to <span class=\"accent\">our team</span>'", "'अपना <span class=\"accent\">मुफ़्त पास</span> लें' : '<span class=\"accent\">हमारी टीम</span> से बात करें'"],
  ["'Questions about exhibiting? Leave your details. To book a booth, <a href=\"/delhi-exhibit\">apply here</a>.'", "'प्रदर्शनी के बारे में सवाल हैं? अपनी जानकारी दें। बूथ बुक करने के लिए <a href=\"/delhi-exhibit\">यहाँ आवेदन करें</a>।'"],
  ["'Exhibition only, entry by time slot. Register to join the waitlist.' : 'Leave your details and our team will get in touch with you.'", "'केवल प्रदर्शनी, तय समय-स्लॉट में प्रवेश। प्रतीक्षा सूची में शामिल होने के लिए रजिस्टर करें।' : 'अपनी जानकारी दें, हमारी टीम आपसे संपर्क करेगी।'"],
  ["fail('Please write your name.'", "fail('कृपया अपना नाम लिखें।'"],
  ["fail('Please check your email. It should look like name@example.com.'", "fail('कृपया अपना ईमेल जाँचें। यह name@example.com जैसा होना चाहिए।'"],
  ["fail('Please add your mobile number.'", "fail('कृपया अपना मोबाइल नंबर जोड़ें।'"],
  ["fail('Please add your mobile number so our team can call you.'", "fail('कृपया मोबाइल नंबर जोड़ें, ताकि हमारी टीम आपको कॉल कर सके।'"],
  ["fail('Please check your mobile number. It needs at least 10 digits.'", "fail('कृपया मोबाइल नंबर जाँचें। इसमें कम से कम 10 अंक होने चाहिए।'"],
  ["fail('Please add your organisation.'", "fail('कृपया अपनी संस्था का नाम जोड़ें।'"],
  ["fail('Please add your designation.'", "fail('कृपया अपना पद जोड़ें।'"],
  ["fail('Please add your city.'", "fail('कृपया अपना शहर जोड़ें।'"],
  ["(pass ? 'Registering...' : 'Sending...')", "(pass ? 'रजिस्टर हो रहा है...' : 'भेजा जा रहा है...')"],
  ["'Something went wrong. Please try again.'", "'कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।'"],
  ["'Could not send. Please check your internet and try again.'", "'भेजा नहीं जा सका। कृपया इंटरनेट जाँचकर फिर कोशिश करें।'"],
  ["var title = 'We have your details';", "var title = 'हमें आपकी जानकारी मिल गई है';"],
  ["'Thank you, ' + first + '. ' + (chosen ? 'We have your request for: ' + chosen + '. Our team will call you to confirm it. ' : 'Our team will get in touch with you. ') + 'We will write to you at ' + email + '.'",
    "'धन्यवाद, ' + first + '। ' + (chosen ? 'आपका अनुरोध मिल गया है: ' + chosen + '। पुष्टि के लिए हमारी टीम आपको कॉल करेगी। ' : 'हमारी टीम आपसे संपर्क करेगी। ') + 'हम आपको ' + email + ' पर लिखेंगे।'"],
  ["already ? 'You are already waitlisted' : 'You are waitlisted'", "already ? 'आप पहले से प्रतीक्षा सूची में हैं' : 'आप प्रतीक्षा सूची में हैं'"],
  ["first + ', ' + email + ' is already waitlisted for a free Visitor Pass for Delhi. There is no need to register again.'",
    "first + ', ' + email + ' दिल्ली के मुफ़्त विज़िटर पास की प्रतीक्षा सूची में पहले से है। दोबारा रजिस्टर करने की ज़रूरत नहीं है।'"],
  ["'Thank you, ' + first + '. You are waitlisted for a free Visitor Pass for Delhi, and an email is on its way to ' + email + '. We will email you when your pass is confirmed.'",
    "'धन्यवाद, ' + first + '। आप दिल्ली के मुफ़्त विज़िटर पास की प्रतीक्षा सूची में हैं, और ' + email + ' पर ईमेल भेजा जा रहा है। पास की पुष्टि होने पर हम आपको ईमेल करेंगे।'"],
]) swap(a, b);

// ---- questions ----
swap('<h2 class="section-title">Questions</h2>', '<h2 class="section-title">सवाल</h2>');
for (const [a, b] of [
  ['When and where is it? <i', 'यह कब और कहाँ है? <i'],
  ['<p>On Wednesday 28 and Thursday 29 July 2027, at Bharat Mandapam, Pragati Maidan, New Delhi.</p>', '<p>बुधवार 28 और गुरुवार 29 जुलाई 2027 को, भारत मंडपम, प्रगति मैदान, नई दिल्ली में।</p>'],
  ['Can I get a pass for Delhi now? <i', 'क्या दिल्ली का पास अभी मिल सकता है? <i'],
  ['<p>Yes. Delegate, Premium Delegate, VIP and Academic passes are <a href="/delhi-register">on sale now</a>. The free Visitor Pass is exhibition only, with entry by time slot: <a href="#updates" data-interest="attend">register here</a> to join the waitlist.</p>',
    '<p>हाँ। डेलीगेट, प्रीमियम डेलीगेट, वीआईपी और एकेडमिक पास <a href="/delhi-register">अभी बिक्री पर हैं</a>। मुफ़्त विज़िटर पास केवल प्रदर्शनी के लिए है, तय समय-स्लॉट में प्रवेश के साथ: प्रतीक्षा सूची में शामिल होने के लिए <a href="#updates" data-interest="attend">यहाँ रजिस्टर करें</a>।</p>'],
  ['How do I book a booth, sponsor or speak? <i', 'बूथ, स्पॉन्सरशिप या वक्ता बनने के लिए क्या करें? <i'],
  ['<p>For a booth, <a href="/delhi-exhibit">apply here</a> and tell us what you will show. We review every application and reply within 2 working days; if approved, our team confirms your place and the next step for booking. We will publish the floor plan later. For a partnership, <a href="/partner#delhi">see what you can sponsor</a> and leave your details. To speak, choose Speak in the <a href="#updates" data-interest="speak">form</a>.</p>',
    '<p>बूथ के लिए <a href="/delhi-exhibit">यहाँ आवेदन करें</a> और बताइए आप क्या दिखाएँगे। हम हर आवेदन की समीक्षा करते हैं और 2 कार्यदिवसों में जवाब देते हैं; स्वीकृति मिलने पर हमारी टीम आपकी जगह और बुकिंग का अगला कदम बताएगी। फ़्लोर प्लान बाद में प्रकाशित होगा। पार्टनरशिप के लिए <a href="/partner#delhi">विकल्प देखें</a> और अपनी जानकारी दें। वक्ता बनने के लिए <a href="#updates" data-interest="speak">फ़ॉर्म</a> में ‘वक्ता’ चुनें।</p>'],
  ['What happens after I pay for a pass? <i', 'पास का भुगतान करने के बाद क्या होगा? <i'],
  ['<p>Your receipt comes by email straight away, and your GST invoice follows from the accounts team. Closer to the event we will email you your entry pass and open the app for Delhi.</p>',
    '<p>रसीद तुरंत ईमेल पर आ जाएगी, और जीएसटी इनवॉइस अकाउंट्स टीम से बाद में आएगा। आयोजन के क़रीब हम आपको प्रवेश पास ईमेल करेंगे और दिल्ली के लिए ऐप खोलेंगे।</p>'],
  ['Is this the same as the Mumbai event? <i', 'क्या यह मुंबई वाला ही आयोजन है? <i'],
  ['<p>No, they are two separate events. Bharat AI Innovation 2026 was held on 20–21 November 2026 at World Trade Center Mumbai. The Delhi edition is on 28–29 July 2027 at Bharat Mandapam. A pass for one does not cover the other.</p>',
    '<p>नहीं, ये दो अलग आयोजन हैं। भारत एआई इनोवेशन 2026, 20–21 नवंबर 2026 को वर्ल्ड ट्रेड सेंटर मुंबई में हुआ। दिल्ली संस्करण 28–29 जुलाई 2027 को भारत मंडपम में है। एक आयोजन का पास दूसरे के लिए मान्य नहीं है।</p>'],
]) swap(a, b);

// ---- before Delhi, Mumbai ----
swap('<h2>Before Delhi, <span class="accent">Mumbai</span></h2>', '<h2>दिल्ली से पहले, <span class="accent">मुंबई</span></h2>');
swap('<p>Bharat AI Innovation 2026 took place on 20–21 November at World Trade Center Mumbai. Here are a few moments from it.</p>', '<p>भारत एआई इनोवेशन 2026, 20–21 नवंबर को वर्ल्ड ट्रेड सेंटर मुंबई में हुआ। देखिए उसकी कुछ झलकियाँ।</p>');
swap('Get your Delhi pass <i', 'अपना दिल्ली पास लें <i');
swap('>More photos from Mumbai</a>', '>मुंबई की और तस्वीरें</a>');

// ---- footer and the bar at the bottom ----
swap("Advancing India's Future Through AI Innovation. Join us in creating a Viksit Bharat by 2047.", 'एआई इनोवेशन के ज़रिए भारत के भविष्य को आगे बढ़ाना। 2047 तक विकसित भारत बनाने में हमारे साथ जुड़ें।');
swap('<h4>Quick Links</h4>', '<h4>उपयोगी लिंक</h4>');
swap('<h4>Event Info</h4>', '<h4>आयोजन की जानकारी</h4>');
swap('<h4>Contact Us</h4>', '<h4>संपर्क करें</h4>');
swap('</i> Delhi edition: Bharat Mandapam, Pragati Maidan, New Delhi</p>', '</i> दिल्ली संस्करण: भारत मंडपम, प्रगति मैदान, नई दिल्ली</p>');
swap('aria-label="Register for Delhi 2027"', 'aria-label="दिल्ली 2027 के लिए रजिस्टर करें"');
swap('<b>28–29 July 2027</b><span>Bharat Mandapam, New Delhi</span>', '<b>28–29 जुलाई 2027</b><span>भारत मंडपम, नई दिल्ली</span>');

// ---- the Prime Minister's quote (kept on the home page, 24 Nov 2026): the quote stays in his words ----
swap('alt="Shri Narendra Modi, Hon\'ble Prime Minister of India, speaking on Artificial Intelligence"', 'alt="माननीय प्रधानमंत्री श्री नरेन्द्र मोदी, आर्टिफ़िशियल इंटेलिजेंस पर बोलते हुए"');
swap('<blockquote class="pm-vision-quote">', '<blockquote class="pm-vision-quote" lang="en">');
swap('<div class="pm-vision-name">Narendra Modi</div>', '<div class="pm-vision-name">नरेन्द्र मोदी</div>');
swap('<div class="pm-vision-title">Hon\'ble Prime Minister of India</div>', '<div class="pm-vision-title">माननीय प्रधानमंत्री, भारत</div>');
swap('This conference is built on PM Modi\'s conviction that AI must strengthen innovation, empower citizens, and drive inclusive growth across every sector of the Indian economy.',
  'यह सम्मेलन प्रधानमंत्री मोदी के इस विश्वास पर आधारित है कि एआई नवाचार को मज़बूत करे, नागरिकों को सशक्त बनाए और भारतीय अर्थव्यवस्था के हर क्षेत्र में समावेशी विकास को आगे बढ़ाए।');

if (problems.length) {
  console.error('gen-delhi-hi: the English page has changed. Update these pairs:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const out = crlf ? s.replace(/\n/g, '\r\n') : s;
if (process.argv.includes('--check')) {
  let have = '';
  try { have = readFileSync(OUT, 'utf8'); } catch {}
  // Line endings differ between checkouts (git stores LF); only the words count.
  if (have.replace(/\r\n/g, '\n') !== out.replace(/\r\n/g, '\n')) { console.error('gen-delhi-hi: public/delhi-hi.html is out of date. Run node scripts/gen-delhi-hi.mjs'); process.exit(1); }
  console.log('gen-delhi-hi: public/delhi-hi.html is up to date');
} else {
  writeFileSync(OUT, out);
  console.log('gen-delhi-hi: wrote public/delhi-hi.html');
}

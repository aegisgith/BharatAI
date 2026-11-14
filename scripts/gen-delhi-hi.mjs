// public/delhi-hi.html, the Delhi 2027 page in Hindi (13 Nov 2026), made from public/delhi.html
// so the design, the effects, the forms and the prices stay the English page's own.
// Every sentence is swapped by an exact [English, Hindi] pair that must be found the number
// of times given: when the English page changes, this stops and names the sentence, and
// the pair is updated. Links still go to the English pages and forms.
//   node scripts/gen-delhi-hi.mjs           write public/delhi-hi.html
//   node scripts/gen-delhi-hi.mjs --check   fail if public/delhi-hi.html is not up to date
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('public/delhi.html', ROOT);
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
    <link rel="alternate" hreflang="en" href="https://bharataiinnovation.com/delhi">
    <link rel="alternate" hreflang="hi" href="https://bharataiinnovation.com/delhi-hi">
    <link rel="alternate" hreflang="x-default" href="https://bharataiinnovation.com/delhi">
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
    <!-- Made by scripts/gen-delhi-hi.mjs from public/delhi.html. Do not edit by hand. -->`);
swap('<html lang="en">', '<html lang="hi">');
swap('    <style>\n', "    <style>\n    /* Hindi: Devanagari letters come from Mukta (fonts.css), the rest stays the site's own. */\n    :root { --font-body: 'Manrope', 'Mukta', sans-serif; --font-display: 'Bricolage Grotesque', 'Mukta', sans-serif; }\n    body { font-family: var(--font-body); }\n");
swap('<a href="#main-content" class="skip-link">Skip to main content</a>', '<a href="#main-content" class="skip-link">मुख्य सामग्री पर जाएँ</a>');

// ---- the menu (its links stay the English pages) ----
for (const [a, b] of [['Home', 'होम'], ['Conference', 'कॉन्फ्रेंस'], ['Exhibition', 'प्रदर्शनी'], ['Networking', 'नेटवर्किंग'], ['Passes', 'पास'], ['Partner', 'पार्टनर'], ['Govt', 'सरकार'], ['Workshops', 'वर्कशॉप'], ['AI Marketplace', 'एआई मार्केटप्लेस'], ['Campus Series', 'कैंपस सीरीज़'], ['AI Readiness', 'एआई रेडीनेस'], ['Contact', 'संपर्क']]) {
  swap(`class="nav-link">${a}</a>`, `class="nav-link">${b}</a>`);
}
swap('class="nav-link active">Delhi 2027</a>', 'class="nav-link active">दिल्ली 2027</a>');
swap('Get your pass', 'अपना पास लें', 3);

// ---- the hero ----
swap('<span>28–29 July 2027</span>', '<span>28–29 जुलाई 2027</span>');
swap('<span>Bharat Mandapam<span class="dl-wide">, New Delhi</span></span>', '<span>भारत मंडपम<span class="dl-wide">, नई दिल्ली</span></span>');
swap('India’s B2B platform for AI comes to the capital. Two days at Bharat Mandapam with the government departments, enterprises and startups using AI, and the companies building it.',
  'भारत का B2B एआई प्लेटफ़ॉर्म अब राजधानी में। भारत मंडपम में दो दिन, उन सरकारी विभागों, उद्यमों और स्टार्टअप्स के साथ जो एआई का उपयोग कर रहे हैं, और उन कंपनियों के साथ जो इसे बना रही हैं।');
swap('</i> Save the date</a>', '</i> कैलेंडर में जोड़ें</a>', 2);
swap('<a href="#booths">Apply for a booth</a> or <a href="#partner">become a partner</a>', '<a href="#booths">बूथ के लिए आवेदन करें</a> या <a href="#partner">पार्टनर बनें</a>');
swap('<a href="/delhi-hi" hreflang="hi" lang="hi">हिन्दी में पढ़ें</a>', '<a href="/delhi" hreflang="en" lang="en">Read in English</a>');

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
  ['Photos from Data Science Congress, the predecessor to Bharat AI Innovation, and a World Trade Center Mumbai boardroom.', 'तस्वीरें डेटा साइंस कांग्रेस (भारत एआई इनोवेशन का पहले का रूप) और वर्ल्ड ट्रेड सेंटर मुंबई के एक बोर्डरूम की हैं।'],
]) swap(a, b);

// ---- passes ----
swap('Passes for <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> के लिए पास');
swap('The same passes as Mumbai. Pay online now, and your receipt comes by email.', 'मुंबई जैसे ही पास। अभी ऑनलाइन भुगतान करें, रसीद ईमेल पर आ जाएगी।');
swap('<h3>Academic Pass</h3>', '<h3>एकेडमिक पास</h3>');
swap('<h3>Delegate Pass</h3>', '<h3>डेलीगेट पास</h3>');
swap('<h3>Premium Delegate Pass</h3>', '<h3>प्रीमियम डेलीगेट पास</h3>');
swap('<h3>VIP Pass</h3>', '<h3>वीआईपी पास</h3>');
swap('<span>+ 18% GST</span>', '<span>+ 18% जीएसटी</span>', 4);
swap('For students and faculty with a valid ID.', 'मान्य पहचान पत्र वाले छात्रों और शिक्षकों के लिए।');
swap('<li>Guaranteed entry on both days</li>', '<li>दोनों दिन पक्का प्रवेश</li>', 2);
swap('<li>Conference sessions and exhibition</li>', '<li>कॉन्फ्रेंस सत्र और प्रदर्शनी</li>', 2);
swap('<li>Student networking zone</li>', '<li>छात्र नेटवर्किंग ज़ोन</li>');
swap('<li>Certificate of participation</li>', '<li>भागीदारी प्रमाणपत्र</li>', 2);
swap('>Get this pass</a>', '>यह पास लें</a>', 4);
swap('For coming to the conference.', 'कॉन्फ्रेंस में आने के लिए।');
swap('<li>Networking lunch and conference kit</li>', '<li>नेटवर्किंग लंच और कॉन्फ्रेंस किट</li>');
swap('<li>Full directory, conversations and meetings</li>', '<li>पूरी डायरेक्टरी, बातचीत और मीटिंग</li>');
swap('A Delegate Pass with a workshop seat.', 'वर्कशॉप सीट के साथ डेलीगेट पास।');
swap('<li>Everything in the Delegate Pass</li>', '<li>डेलीगेट पास की सभी सुविधाएँ</li>');
swap('<li>One hands-on workshop, seats first come, first served</li>', '<li>एक व्यावहारिक वर्कशॉप; सीटें पहले आओ, पहले पाओ</li>');
swap('The full event, with the leaders’ evening.', 'पूरा आयोजन, लीडर्स इवनिंग के साथ।');
swap('<li>Everything in the Premium Delegate Pass</li>', '<li>प्रीमियम डेलीगेट पास की सभी सुविधाएँ</li>');
swap('<li>Bharat AI Leaders’ Evening, Day 1</li>', '<li>भारत एआई लीडर्स इवनिंग, पहला दिन</li>');
swap('<li>VIP lounge and priority seating</li>', '<li>वीआईपी लाउंज और आगे की सीटें</li>');
swap('<li>Speaker meet &amp; greet</li>', '<li>वक्ताओं से मुलाक़ात</li>');
swap('<b>Visitor Pass, free.</b> Exhibition only, entry by time slot. <a href="#updates" data-interest="attend">Register to join the waitlist</a>',
  '<b>विज़िटर पास, मुफ़्त।</b> केवल प्रदर्शनी, तय समय-स्लॉट में प्रवेश। <a href="#updates" data-interest="attend">प्रतीक्षा सूची में शामिल होने के लिए रजिस्टर करें</a>');
swap('Teams of five or more: five passes for the price of four (Delegate or Premium Delegate), on request. A pass is for Delhi only. Your entry pass and the app for Delhi come by email closer to the event.',
  'पाँच या अधिक लोगों की टीम: चार की क़ीमत में पाँच पास (डेलीगेट या प्रीमियम डेलीगेट), अनुरोध पर। पास केवल दिल्ली के लिए है। प्रवेश पास और दिल्ली का ऐप आयोजन के क़रीब ईमेल से आएगा।');

// ---- booths ----
swap('Book a booth in <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> में बूथ बुक करें');
swap('The same sizes and prices as Mumbai. We will publish the floor plan later.', 'मुंबई जैसे ही आकार और दाम। फ़्लोर प्लान बाद में प्रकाशित होगा।');
swap('Tell us what you will show. We review every application so the floor stays relevant for the people who come to buy. We reply within 2 working days. If approved, our team confirms your place and the next step for booking your booth.',
  'बताइए आप क्या दिखाएँगे। हम हर आवेदन की समीक्षा करते हैं, ताकि प्रदर्शनी उन लोगों के काम की रहे जो ख़रीदने आते हैं। हम 2 कार्यदिवसों में जवाब देते हैं। स्वीकृति मिलने पर हमारी टीम आपकी जगह और बूथ बुक करने का अगला कदम बताएगी।');
swap('A booth at Data Science Congress, the predecessor to Bharat AI Innovation.', 'डेटा साइंस कांग्रेस (भारत एआई इनोवेशन का पहले का रूप) का एक बूथ।');
swap(' exhibitor passes · ', ' एग्ज़िबिटर पास · ', 5);
swap(' exhibitor pass · ', ' एग्ज़िबिटर पास · ', 2);
swap(' sqft) · ', ' वर्ग फ़ुट) · ', 7);
swap(' min Innovation Talk</span>', ' मिनट इनोवेशन टॉक</span>', 7);
swap('>Apply for this booth</a>', '>इस बूथ के लिए आवेदन करें</a>', 7);
swap('<small>+ GST</small>', '<small>+ जीएसटी</small>', 12);
swap('<a href="/exhibition">See what each booth includes</a>', '<a href="/exhibition">देखें हर बूथ में क्या शामिल है</a>');

// ---- partners ----
swap('Partner with us in <span class="accent">New Delhi</span>', '<span class="accent">नई दिल्ली</span> में हमारे पार्टनर बनें');
swap('The same partnerships and sponsorships as Mumbai, at the same prices.', 'मुंबई जैसी ही पार्टनरशिप और स्पॉन्सरशिप, उन्हीं दामों पर।');
swap('<h3 class="dl-sale-head">Partnership tiers</h3>', '<h3 class="dl-sale-head">पार्टनरशिप स्तर</h3>');
swap('<h3 class="dl-sale-head">Branding and activation</h3>', '<h3 class="dl-sale-head">ब्रांडिंग और एक्टिवेशन</h3>');
for (const [a, b] of [
  ['<span>1 slot, exclusive. “[Your Company] Presents Bharat AI Innovation Delhi 2027”</span>', '<span>1 स्लॉट, एक्सक्लूसिव। “[आपकी कंपनी] प्रस्तुत करती है भारत एआई इनोवेशन दिल्ली 2027”</span>'],
  ['<span>1 slot, exclusive. Technology and infrastructure branding</span>', '<span>1 स्लॉट, एक्सक्लूसिव। टेक्नोलॉजी और इंफ्रास्ट्रक्चर ब्रांडिंग</span>'],
  ['<span>1 slot, exclusive. Co-shape the conference themes and tracks</span>', '<span>1 स्लॉट, एक्सक्लूसिव। कॉन्फ्रेंस के विषय और ट्रैक साथ मिलकर तय करें</span>'],
  ['<span>4 slots. Category exclusivity in FinTech, HealthTech, AgriTech or MfgTech</span>', '<span>4 स्लॉट। फ़िनटेक, हेल्थटेक, एग्रीटेक या मैन्युफ़ैक्चरिंग टेक में श्रेणी की एक्सक्लूसिविटी</span>'],
  ['<span>For those championing new technologies and startups</span>', '<span>नई तकनीकों और स्टार्टअप्स को आगे बढ़ाने वालों के लिए</span>'],
  ['<span>A panel you curate, with your own leader moderating</span>', '<span>आपका तैयार किया पैनल, जिसका संचालन आपके अपने लीडर करें</span>'],
  ['<span>Co-branded round table on AI policy</span>', '<span>एआई नीति पर को-ब्रांडेड गोलमेज़ बैठक</span>'],
  ['<span>Host the whole evening</span>', '<span>पूरी शाम की मेज़बानी करें</span>'],
  ['<span>The only brand on every attendee’s lanyard</span>', '<span>हर प्रतिभागी के लैन्यार्ड पर केवल आपका ब्रांड</span>'],
  ['<span>The only brand on the bag delegates take home</span>', '<span>डेलीगेट्स जो बैग घर ले जाते हैं, उस पर केवल आपका ब्रांड</span>'],
  ['<span>The networking lunch, presented by you, on both days</span>', '<span>दोनों दिन नेटवर्किंग लंच, आपकी ओर से</span>'],
  ['<span>For AI companies: the named AI Partner of the event</span>', '<span>एआई कंपनियों के लिए: आयोजन का घोषित एआई पार्टनर</span>'],
  ['<span>Your brand on the trophies and the awards moment</span>', '<span>ट्रॉफ़ियों और पुरस्कार के पल पर आपका ब्रांड</span>'],
  ['<span>Invite-only, on a theme you set</span>', '<span>केवल आमंत्रण पर, आपके तय किए विषय पर</span>'],
  ['<span>A launch, an MoU signing or a campaign of your own</span>', '<span>लॉन्च, समझौता ज्ञापन (MoU) पर हस्ताक्षर, या आपका अपना अभियान</span>'],
  ['<p>₹1.2 Cr</p>', '<p>₹1.2 करोड़</p>'],
  ['<p>Custom</p>', '<p>कस्टम</p>'],
]) swap(a, b);
swap(' Lakhs</p>', ' लाख</p>', 3);
swap(' Lakhs <small>', ' लाख <small>', 5);
swap('<p>On request</p>', '<p>अनुरोध पर</p>', 5);
swap('>Enquire</a>', '>पूछताछ करें</a>', 15);
swap('Choose one and leave your details, and our team will call you. <a href="/partner">See what each one includes</a>', 'एक विकल्प चुनें और अपनी जानकारी दें, हमारी टीम आपको कॉल करेगी। <a href="/partner">देखें हर एक में क्या शामिल है</a>');

// ---- the venue ----
swap('Bharat Mandapam, <span class="accent">New Delhi</span>', 'भारत मंडपम, <span class="accent">नई दिल्ली</span>');
swap('The international convention and exhibition centre at Pragati Maidan, in the heart of the capital.', 'प्रगति मैदान स्थित अंतरराष्ट्रीय सम्मेलन और प्रदर्शनी केंद्र, राजधानी के बीचोंबीच।');
swap('<li>Hosted the G20 Leaders’ Summit in September 2023</li>', '<li>सितंबर 2023 में G20 लीडर्स समिट की मेज़बानी की</li>');
swap('<li>Conference halls and exhibition space in one complex</li>', '<li>एक ही परिसर में सम्मेलन हॉल और प्रदर्शनी स्थल</li>');
swap('<li>A bronze Nataraja stands at its entrance</li>', '<li>प्रवेश द्वार पर कांस्य की नटराज प्रतिमा</li>');
swap('Get directions <i', 'रास्ता देखें <i');

// ---- coming from outside India ----
swap('Coming from <span class="accent">outside India</span>', '<span class="accent">भारत के बाहर</span> से आ रहे हैं?');
swap('What to know before you book your travel.', 'यात्रा बुक करने से पहले यह जान लें।');
swap('</i>Visa</dt><dd>Check which visa you need on the official site, <a href="https://indianvisaonline.gov.in/" target="_blank" rel="noopener noreferrer">indianvisaonline.gov.in</a>. If your application asks for a letter from the organisers, <a href="/delhi-visa">ask us for one</a>. Please wait for your visa before booking travel you cannot cancel.</dd>',
  '</i>वीज़ा</dt><dd>आपको कौन-सा वीज़ा चाहिए, यह आधिकारिक साइट <a href="https://indianvisaonline.gov.in/" target="_blank" rel="noopener noreferrer">indianvisaonline.gov.in</a> पर देखें। अगर आवेदन में आयोजकों का पत्र माँगा जाए, तो <a href="/delhi-visa">हमसे अनुरोध करें</a>। ऐसी यात्रा बुक करने से पहले, जिसे रद्द न किया जा सके, वीज़ा मिलने का इंतज़ार करें।</dd>');
swap('</i>From the airport</dt><dd>Indira Gandhi International Airport (DEL) is about 18 km from Bharat Mandapam. Allow an hour by road at busy times.</dd>',
  '</i>हवाई अड्डे से</dt><dd>इंदिरा गांधी अंतरराष्ट्रीय हवाई अड्डा (DEL) भारत मंडपम से लगभग 18 किमी दूर है। व्यस्त समय में सड़क से एक घंटा मानकर चलें।</dd>');
swap('</i>By metro</dt><dd>The nearest station is Supreme Court, once called Pragati Maidan, on the Blue Line. The venue is a short walk away.</dd>',
  '</i>मेट्रो से</dt><dd>सबसे नज़दीकी स्टेशन ब्लू लाइन पर सुप्रीम कोर्ट है, जिसका पुराना नाम प्रगति मैदान था। आयोजन स्थल वहाँ से पैदल दूरी पर है।</dd>');
swap('</i>Time and money</dt><dd>India Standard Time is UTC+5:30. Passes are priced in Indian rupees, plus 18% GST.</dd>',
  '</i>समय और भुगतान</dt><dd>भारतीय मानक समय UTC+5:30 है। पास की क़ीमतें भारतीय रुपये में हैं, साथ में 18% जीएसटी।</dd>');
swap('Ask for a visa letter <i', 'वीज़ा पत्र के लिए अनुरोध करें <i');

// ---- who it is for ----
swap('Built for business, <span class="accent">in the capital</span>', 'व्यापार के लिए, <span class="accent">राजधानी में</span>');
swap('India’s ministries and public sector companies are based in Delhi. This edition is for the people who buy AI, build it and write its rules.', 'भारत के मंत्रालय और सार्वजनिक क्षेत्र की कंपनियाँ दिल्ली में हैं। यह संस्करण उन लोगों के लिए है जो एआई ख़रीदते हैं, बनाते हैं और उसके नियम तय करते हैं।');
swap('<b>Buyers</b><span>CIOs, CTOs and procurement heads from enterprises, public sector companies and government departments.</span>', '<b>ख़रीदार</b><span>उद्यमों, सार्वजनिक क्षेत्र की कंपनियों और सरकारी विभागों के सीआईओ, सीटीओ और ख़रीद प्रमुख।</span>');
swap('<b>Builders</b><span>AI product companies, service firms and funded startups.</span>', '<b>निर्माता</b><span>एआई प्रोडक्ट कंपनियाँ, सर्विस फ़र्म और फ़ंडिंग पाए स्टार्टअप्स।</span>');
swap('<b>Policymakers</b><span>The people shaping India’s AI rules, at the centre and in the states.</span>', '<b>नीति-निर्माता</b><span>केंद्र और राज्यों में भारत के एआई नियम तय करने वाले लोग।</span>');

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
  ['<p>For a booth, <a href="/delhi-exhibit">apply here</a> and tell us what you will show. We review every application and reply within 2 working days; if approved, our team confirms your place and the next step for booking. We will publish the floor plan later. For a <a href="#partner">partnership</a>, choose one and leave your details. To speak, choose Speak in the <a href="#updates" data-interest="speak">form</a>.</p>',
    '<p>बूथ के लिए <a href="/delhi-exhibit">यहाँ आवेदन करें</a> और बताइए आप क्या दिखाएँगे। हम हर आवेदन की समीक्षा करते हैं और 2 कार्यदिवसों में जवाब देते हैं; स्वीकृति मिलने पर हमारी टीम आपकी जगह और बुकिंग का अगला कदम बताएगी। फ़्लोर प्लान बाद में प्रकाशित होगा। <a href="#partner">पार्टनरशिप</a> के लिए एक विकल्प चुनें और अपनी जानकारी दें। वक्ता बनने के लिए <a href="#updates" data-interest="speak">फ़ॉर्म</a> में ‘वक्ता’ चुनें।</p>'],
  ['What happens after I pay for a pass? <i', 'पास का भुगतान करने के बाद क्या होगा? <i'],
  ['<p>Your receipt comes by email straight away, and your GST invoice follows from the accounts team. Closer to the event we will email you your entry pass and open the app for Delhi.</p>',
    '<p>रसीद तुरंत ईमेल पर आ जाएगी, और जीएसटी इनवॉइस अकाउंट्स टीम से बाद में आएगा। आयोजन के क़रीब हम आपको प्रवेश पास ईमेल करेंगे और दिल्ली के लिए ऐप खोलेंगे।</p>'],
  ['Is this the same as the Mumbai event? <i', 'क्या यह मुंबई वाला ही आयोजन है? <i'],
  ['<p>No, they are two separate events. Bharat AI Innovation 2026 is on 20–21 November 2026 at World Trade Center Mumbai. The Delhi edition is on 28–29 July 2027 at Bharat Mandapam. A pass for one does not cover the other.</p>',
    '<p>नहीं, ये दो अलग आयोजन हैं। भारत एआई इनोवेशन 2026, 20–21 नवंबर 2026 को वर्ल्ड ट्रेड सेंटर मुंबई में है। दिल्ली संस्करण 28–29 जुलाई 2027 को भारत मंडपम में है। एक आयोजन का पास दूसरे के लिए मान्य नहीं है।</p>'],
]) swap(a, b);

// ---- before Delhi, Mumbai ----
swap('<h2>Before Delhi, <span class="accent">Mumbai</span></h2>', '<h2>दिल्ली से पहले, <span class="accent">मुंबई</span></h2>');
swap('<p>Bharat AI Innovation 2026 is on 20–21 November at World Trade Center Mumbai. Passes are open now.</p>', '<p>भारत एआई इनोवेशन 2026, 20–21 नवंबर को वर्ल्ड ट्रेड सेंटर मुंबई में है। पास अभी उपलब्ध हैं।</p>');
swap('Get my Delegate Pass <i', 'मेरा डेलीगेट पास लें <i');
swap('>Expo Pass for Mumbai, &#8377;999</a>', '>मुंबई के लिए एक्सपो पास, &#8377;999</a>');

// ---- footer and the bar at the bottom ----
swap("Advancing India's Future Through AI Innovation. Join us in creating a Viksit Bharat by 2047.", 'एआई इनोवेशन के ज़रिए भारत के भविष्य को आगे बढ़ाना। 2047 तक विकसित भारत बनाने में हमारे साथ जुड़ें।');
swap('<h4>Quick Links</h4>', '<h4>उपयोगी लिंक</h4>');
swap('<h4>Event Info</h4>', '<h4>आयोजन की जानकारी</h4>');
swap('<h4>Contact Us</h4>', '<h4>संपर्क करें</h4>');
swap('</i> Delhi edition: Bharat Mandapam, Pragati Maidan, New Delhi</p>', '</i> दिल्ली संस्करण: भारत मंडपम, प्रगति मैदान, नई दिल्ली</p>');
swap('aria-label="Register for Delhi 2027"', 'aria-label="दिल्ली 2027 के लिए रजिस्टर करें"');
swap('<b>28–29 July 2027</b><span>Bharat Mandapam, New Delhi</span>', '<b>28–29 जुलाई 2027</b><span>भारत मंडपम, नई दिल्ली</span>');

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

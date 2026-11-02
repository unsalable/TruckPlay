# TruckPlay

Euro Truck Simulator 2'de tırın kendi multimedya ekranında (oyunun GPS'inin çizildiği yerde) çalışan,
Apple CarPlay hissinde bir arayüz: Liquid Glass camlar, yay fiziğiyle animasyonlar, oyunun haritası
Apple Haritalar görünümünde, yol üstünde ve ön camda HUD, Spotify ve YouTube Music, radyo, YouTube ve
tarayıcı.

```
oyun (eurotrucks2.exe)                       bilgisayar
┌───────────────────────────────┐   pipe     ┌────────────────────────────────┐
│ plugin/truckplay.dll          │◄──────────►│ host/ (Electron, ekran dışı)   │
│  telemetri, D3D11 kancaları,  │ paylaşımlı │  ui/ (React) kareleri çizer,   │
│  fare/klavye, "yaklaş" paneli │◄═══════════│  girdiyi arayüze iletir        │
└───────────────────────────────┘   bellek   └────────────────────────────────┘
mod/ → truckplay.scs: GPS ekran betiklerini TruckPlay'in dokusunu çizecek şekilde değiştirir
```

## Kurulum

### Oyuncular için: tek dosya

`TruckPlay-Kurulum.exe`'yi oyun kapalıyken çalıştır. Başka bir şey kurmak gerekmez: Node.js ve
Chromium uygulamanın içindedir. Kurulum şunları yapar:

1. TruckPlay'i `%LOCALAPPDATA%\TruckPlay` klasörüne kurar.
2. Oyun eklentisini (`truckplay.dll`) oyunun `bin\win_x64\plugins` klasörüne koyar.
3. Modu (`truckplay.scs`) oyuncunun kendi oyun dosyalarından üretir ve
   `Belgeler\Euro Truck Simulator 2\mod` klasörüne koyar. Her tırın ekranı ayrı ölçülür, sahip
   olunan DLC tırları da dahil.
4. Harita verisini indirir (~115 MB, bir kere).
5. Masaüstüne ve Başlat menüsüne kısayol koyar: oyunsuz deneme penceresi ve kaldırma.

Sonra ETS2'yi aç. İlk açılışta oyunun eklenti uyarısını onayla, profil ekranında
**Mod Yöneticisi**'nden **TruckPlay**'i etkinleştir ve tıra bin. TruckPlay oyunla birlikte açılır
ve oyunla kapanır.

- Oyun güncellenince kurulumu yeniden çalıştır; mod yeni sürüme göre yeniden üretilir.
- Kaldırmak için Başlat menüsü › TruckPlay › **TruckPlay'i kaldır**'ı ya da
  `TruckPlay-Kurulum.exe -Uninstall`'u kullan.
- Oyun bulunamazsa: `TruckPlay-Kurulum.exe -GameDir "D:\Oyunlar\Euro Truck Simulator 2"`.
- Kurulum dosyası imzasız. Windows "bilgisayarınızı korudu" derse **Ek bilgi › Yine de çalıştır**'a bas.

Neden mod klasörüne atılan tek bir `.scs` yetmiyor? ETS2 kod içeren eklentileri (DLL) yalnız kendi
`bin\win_x64\plugins` klasöründen yükler. Mod klasöründeki dosyalar yalnız oyun içeriği olabilir.
Görüntüyü ekrana taşıyan eklenti ve uygulama olmadan mod tek başına bir şey göstermez. Bu yüzden
dağıtılan şey, hepsini yerine koyan tek bir kurulum dosyasıdır.

Steam Atölyesi gerekmez. İstenirse `node scripts/paket.mjs --workshop` modu Atölye klasörü olarak da
üretir (`dist\workshop\`, adımlar `ATOLYE.txt`'de).

Kurulum dosyasını üretmek için `node scripts/paket.mjs` çalıştırılır. Sonuç
`dist\TruckPlay-Kurulum.exe` olur (~150 MB). `--skip-build` derlemeyi atlar.

### Geliştirici kurulumu

Gerekenler: Windows 10/11, ETS2 (DirectX 11), Node.js 22+, Visual Studio 2022+ C++ araçları.

```bash
powershell -ExecutionPolicy Bypass -File scripts\kur.ps1
```

Betik sırasıyla şunları yapar:

1. Arayüzü ve eklentiyi derler.
2. Harita verisini `map\data` klasörüne indirir (~115 MB, bir kere).
3. Oyunun şehir adlarını okur.
4. Modu oyunun kendi dosyalarından üretir.
5. `truckplay.dll`'i `bin\win_x64\plugins` klasörüne kopyalar.
6. Masaüstüne oyunsuz deneme kısayolu koyar.

Oyun güncellenince betiği yeniden çalıştırmak yeterli.

- `-Mode calibrate`: ekran dokularına yüzde ızgarası ve renkli köşeler çizer (görüntünün cama tam
  oturduğunu oyunda görmek için).
- `-Uninstall`: her şeyi kaldırır.

Host oyunla birlikte kendiliğinden açılır. Elle açmak için `TruckPlay.cmd` kullanılır.

## Kullanım

| Tuş | İşlev |
| --- | --- |
| **G** (basılı tut) | Kamera durur, fare ekranda imleç olur. Tık dokunma, tekerlek kaydırma sayılır. Geri için uygulamanın sol üstündeki düğme ya da raydaki ana ekran düğmesi. |
| **Y** | Ekrana yaklaş: kabin ekranı ortada büyür (video izlemek, yazı yazmak için). Tekrar Y ya da Esc ile kapanır. |
| **Esc** | Oyunun menüsü. TruckPlay'de çalan her şey durur: radyo, müzik, YouTube, sayfalar ve bilgisayardaki Spotify. Oyuna dönünce kaldığı yerden devam eder. |

İmleci eklenti, oyunun her karesinde farenin o anki konumuna doğrudan dokuya çizer. Arayüzün kendi
karesini beklemediği için gecikmesizdir. Düğmelerin üstünde iPadOS'taki gibi plakaya, uygulama
ikonlarında CarPlay'in beyaz odak çerçevesine, yazı alanlarında I imlecine dönüşür.

- Ana ekranda sayfalar fare tekerleğiyle de değişir.
- Rayın altındaki hoparlör TruckPlay'in sesidir: Windows ses karıştırıcısındaki kendi sesi.
  Dokununca Denetim Merkezi'ndeki gibi bir ses sürgüsü açılır, tekerlekle de ayarlanır. Aynı sürgü
  Şimdi Çalınan'da da var.
- Tuşlar Ayarlar › Ekran ve Tuşlar'dan değişir. Bir metin alanına dokununca klavye TruckPlay'e
  geçer; Enter ya da Esc bırakır.
- Esc'te durdurmak istemezsen: Ayarlar › **Oyun durunca medyayı duraklat**.

### Her tırın ekranına tam oturma

Her tırın kabin ekranı, oyunun GPS görüntüsünün başka bir bölümünü başka bir oranda gösterir. Mod
üretilirken her kabin modelinin ekran parçası okunur (`mod/lib/screens.mjs`): camın dokunun hangi
bölümünü gösterdiği ve gerçek eni ile boyu. Her ayrı ekran kendi GPS betiğini ve kendi boyda
dokusunu alır, kabin tanımları bu betiği gösterir. Böylece arayüz her tırda camın kenarından
kenarına ve camın kendi oranında çizilir. Oyunda 37 ayrı ekran var; örneğin Scania S/R 2016 1.61:1,
Iveco Stralis 2.15:1, MAN TGX 2020 2.63:1.

Başka modlardan gelen tırlar oyunun genel GPS betiğini kullanır. Onlarda arayüz çoğu kabinin
camının bulunduğu yere yerleşir. Ayarlar › Ekran ve Tuşlar › **Ekranı tıra oturt** ile kenarlar
camın kenarına kaydırılır ve ayar o tır için saklanır.

## Uygulamalar

- **Gösterge Paneli**: canlı harita, sıradaki hedef, çalan müzik ve teslimatın canlı etkinliği.
- **Widget'lar**: oyun saati, dinlenme sayacı, yakıt/AdBlue/hız/hasar.
- **Haritalar**: oyunun haritası Apple Haritalar stilinde (gündüz/gece). Rayın en üstünde hep
  sabit durur.
  - Hedefi oyun belirler, TruckPlay'in ayrı bir hedef seçimi yok. İş varken işin varış noktası;
    yokken oyunun haritasında (M) işaretlediğin yer. Arada işaretlediğin ara noktalar da rotaya
    girer, sırasıyla. Konvoyda oyun ayrı bir çok oyunculu rota tutar; o kullanılır.
  - İşaretler oyunun kayıt dosyasından okunur (oyun birkaç dakikada bir kendiliğinden kaydeder,
    konvoyda da). İşareti oyunda kaldırınca hedef hemen kalkar: oyunun canlı "kalan mesafe" bilgisi
    rotanın bittiğini söyler, kaydı beklemez.
  - Arama ve yakındakiler: servisler (F7 ile çağrılan çekicinin götürdüğü tamir noktaları), yakıt,
    dinlenme, garajlar. Bir yere dokununca harita oraya gider ve bilgi kartı çıkar.
  - Harita ikonları: servisler, yakıt istasyonları, dinlenme ve park yerleri, garajlar (satın
    aldıkların ayrı işaretli), bayiler, iş bulma ajansları, şirketler, feribot ve tren, gişe/sınır/
    kantar, manzara noktaları. Hepsi açık gelir; Ayarlar › Haritalar'dan tek tek kapatılır.
  - 3B ya da 2B, yön yukarı ya da kuzey yukarı ve 3B binalar Ayarlar › Haritalar'dadır.
  - Hıza göre yakınlaşma, yol kalkanları. Mavi rota çizgisi oyunun kendi yol ağından gelir
    (aşağıda "Yol üstü gösterge").
- **Konvoy**: oyunun kendi konvoy sistemi kullanılır, TruckPlay'in ayrı bir konvoyu yok. Konvoydaki
  ortak iş ve oyunun çok oyunculu rotası Haritalar'a ve HUD'a gelir.
- **Müzik** dört sekmeden oluşur ve aynı anda tek şey çalar.
  - **Spotify**: bilgisayardaki Spotify uygulaması (masaüstü ya da Microsoft Store sürümü).
    Ücretsiz, reklamlı sürüm de olur. Kapak, ilerleme çubuğu ve kontroller Windows medya
    oturumundan gelir. **Spotify'ı başlat** onu oyunun önüne pencere açmadan, küçültülmüş başlatır
    ve kaldığı şarkıdan çalar. Yüklü değilse bunu söyler.
  - **YouTube Music**: reklam engelleyiciyle, ücretsiz ve reklamsız. Müzik'ten çıkınca da çalmaya
    devam eder.
  - **Radyo**: Türk radyoları ve oyunun radyo listesi.
  - **Kitaplık**: bilgisayardaki müzikler.
- **Tarayıcı**: Safari tarzı; yüzen cam adres çubuğu, öneriler, sekmeler, sık kullanılanlar.
  Sayfadaki yazı alanları klavyeyi alır. Tam ekran video ekranın içinde açılır, geri ile çıkılır.
- **YouTube**: tam ekran sağ alttaki düğmeyle açılır.
- **Reklam engelleyici**: tarayıcıda, YouTube'da ve YouTube Music'te. Açık gelir, Ayarlar › Web'den
  kapatılır.
- **Duvar kâğıtları**: hareketli olanlar (Kuzey Işıkları, Sıvı Cam, Işıltı), manzaralar, renkler ve
  oyunda F10 ile aldığın ekran görüntüleri (Ayarlar › Duvar Kâğıdı).
- **Görünüm**: Açık ya da Koyu. Koyu varsayılandır.
- **Tır**: hız, devir, yakıt, sıcaklıklar, hasarlar, ışıklar.
- **Teslimat**: yük, rota, ücret ve teslim saati.
- **Mesajlar** ve **Ayarlar**.
- Ceza, otoyol ücreti, feribot ve teslimat gibi oyun olayları CarPlay bildirimi olarak üstten düşer.

## Yol üstü gösterge (HUD)

Bir hedef varken (iş ya da oyunda işaretlediğin yer) oyunun görüntüsünün üstünde, ortada bir kart
durur:

- **Sıradaki manevra**: dönüş oku, ona kalan mesafe ve talimat. Örnekler: "Sağdan çıkın",
  "Solda kalın", "Dönel kavşakta 3. çıkış", "Feribota binin · Dover".
- Mesafenin rakamları geri sayarken kayar. Son birkaç yüz metrede alttaki çizgi dolar. Dönüş anında
  ok kutusu maviye döner ve "Şimdi" yazar.
- İki dönüş arka arkaya geliyorsa kartın altında **"Sonra"** çipi çıkar.
- **Hız ve hız sınırı**: sınır aşılınca hız kırmızıya döner.
- Esc menüsünde, oyun duraklayınca ve "yaklaş" ekranı açıkken görünmez.

Ayarlar › Yol üstü gösterge'den açılıp kapanır. Aynı yerden üst/alt konum ve küçük/orta/büyük
boyut seçilir.

### Ön cam göstergesi

Gerçek tırlardaki head-up display gibi: kabin kamerasında, camın hafif altında, yolun üstüne
düşen saydam ışık. Panel yok, yalnız hafif parlayan rakamlar ve işaretler:
- ortada hız, yanında hız sınırı (kırmızı halka), açıksa hız sabitleyicinin hızı (yeşil);
- rota varken solda sıradaki dönüşün oku, kalan mesafe ve dönüşe yaklaştıkça dolan çizgi;
- sınır aşılınca hız turuncuya döner.

Görüntü kabine sabittir: başını çevirince (fare, kamera ayarları) camdaki yerinde kalır, bakışını
çok uzağa çevirince gerçek bir HUD gibi kaybolur. Yalnız kabin kamerasında görünür; dış kameralarda
üstteki kart kalır. Kabinde ön cam göstergesi açıksa kartın yerini alır. Ayarlar › Yol üstü gösterge
› **Ön cam göstergesi** ile açılır; **Camdaki yüksekliği** alçak, orta ya da yüksek seçilir.

### Sesli yönlendirme

- **Uyarı sesi** dönüş anında kısa bir çan çalar; varsayılan olarak açık.
- **Sesli yönlendirme** dönüşleri okur: "400 metre sonra sağdan çıkın, ardından sola dönün". Arka
  arkaya gelen dönüşler Google Haritalar'daki gibi birlikte söylenir. **Kadın** ya da **erkek**
  ses seçilir, **Sesi dinle** örnek okur.
- Konuşan, kurulumla gelen doğal ses paketidir (`voices/`; her cümle bir kere doğal bir sesle
  okunmuş MP3, oyunda çevrimdışı çalar). Paket yoksa Windows'un sesi okur (Türkçede Microsoft
  Tolga).
- Ses paketini üretmek (bir kere, geliştirici): Google Cloud Text-to-Speech ya da Azure Speech'in
  ücretsiz kotasıyla `node scripts/voices.mjs --provider google --key <API anahtarı>` (Azure için
  `--provider azure --key <anahtar> --region <bölge>`). Bir paket birkaç bin karakter tutar;
  ücretsiz aylık kotanın çok altında. Üretilen paket kurulum dosyasına girer, kullananların anahtara
  ihtiyacı olmaz.

## Rota danışmanında TruckPlay (F3)

F3 ile açılan rota danışmanının (sağ alttaki pencere yığını) en üstünde, TruckPlay ekranının bir
kopyası durur: yolda video izlemek ya da haritaya bakmak için. Ekran kendi oranıyla, köşeleri
yuvarlak çizilir. Ayarlar › Rota danışmanı (F3) › **TruckPlay ekranı** ile açılır; kapalıyken
görünmez.

## Rotanın kaynağı

Dönüşler tahmin değil. Kurulum, oyuncunun kendi oyun dosyalarından yol ağını çıkarır
(`map/build-graph.mjs` → `map/data/graph.bin`); sahip olunan DLC haritaları dahildir. Ağda şunlar
var:
- her yol, şerit sayısı ve hangi yönde gidilebildiği;
- her kavşakta oyunun GPS'inin kullandığı bağlantılar (prefab "nav node"ları);
- feribot ve tren hatları.

Rota bu ağ üzerinde hesaplanır. Talimatlar da kavşağın gerçek şerit eğrilerinden çıkar:
- Ana yol ile çıkış rampası şerit sayısından ayırt edilir.
- Dönel kavşaklarda geçilen çıkışlar sayılır. Parça parça kurulmuş halkalar da buna dahil.
- Ana yolda düz devam ederken hiçbir şey söylenmez.

## Bilinen sınırlar

- Spotify'ı reklamsız dinlemenin izinli tek yolu Premium. İstemciyi yamalayan araçlar Spotify'ın
  kullanım koşullarına aykırı olduğu için TruckPlay'de yoktur. Reklamsız müzik için YouTube Music
  sekmesi var.
- uBlock Origin Lite bir Chrome eklentisidir ve Electron'un desteklemediği bir tarayıcı arayüzüne
  (declarativeNetRequest) dayanır. Onun yerine Ghostery'nin reklam engelleme motoru, uBlock Origin'in
  ve EasyList'in filtre listeleriyle ağ isteklerini süzer. YouTube'da reklam verisi ayrıca sayfanın
  içinde temizlenir. Listeler haftada bir yenilenir.
- Oyun haritadaki işaretlerini eklentilere canlı vermez; TruckPlay onları oyunun kayıt dosyasından
  okur. Yeni bir işaret, oyun kaydedene kadar (otomatik kayıt birkaç dakikada bir) gecikebilir.
  Kaldırılan işaret ise hemen düşer.
- TruckPlay oyunun M haritasına işaret koyamaz: oyun buna izin veren bir yol açmıyor. Konvoyda
  kurucunun işaretlerini oyun herkese dağıtıyorsa TruckPlay'de de görünür; dağıtmıyorsa ortak iş
  ve kişinin kendi işaretleri görünür.
- Ön cam göstergesi kafanın konumunu ve yönünü oyunun telemetrisinden alır. Oyun kameranın görüş
  açısını (FOV) vermediği için 50° dikey görüş açısı varsayılır; FOV'u çok farklı ayarladıysan
  göstergenin yeri **Camdaki yüksekliği** ile düzeltilir. Kabin kamerası, kabin ekranının çizilip
  çizilmediğine bakılarak anlaşılır.
- Microsoft Edge'in ücretsiz çevrimiçi sesleri resmi bir arayüz değil (Edge'i taklit etmeyi
  gerektirir), bu yüzden kullanılmıyor. Doğal ses için ses paketi resmi Google/Azure arayüzleriyle
  üretilir.
- HUD'un rotası TruckPlay'in kendi rotasıdır. Oyun kendi GPS rotasını dışarı vermez; ikisi aynı
  yol ağında aynı hızlı yolu aradığı için çoğu zaman örtüşür, ama başka bir yoldan gidebilir.
  Rotadan çıkınca birkaç saniye içinde yeniden hesaplanır. Şerit yönlendirmesi henüz yok.
- Konvoyda (çok oyunculu) oyun Esc'te durmaz. TruckPlay Esc tuşunu kendisi izler. Menüyü fareyle
  kapatırsan müzik sürmeye başlayınca devam eder.

## Geliştirme

```bash
npm --prefix ui run dev
```

Arayüz `http://localhost:5299` adresinde, oyunsuz demo sürüşle açılır: İstanbul'dan Edirne'ye
gerçek otoyolda giden bir Scania. Tır ekranının boyutunu denemek için `?w=1282&h=721` ekle.

- `npm --prefix ui test`: birim testleri. `npx tsc -b` (ui klasöründe): tip denetimi.
- `scripts\build-plugin.cmd`: eklentiyi, medya yardımcısını (`truckplay-media.exe`), kurulum
  programını ve test araçlarını derler.
- `plugin\build\hooktest.exe`: D3D11 kancalarını oyunsuz dener.
- `plugin\build\testcab.exe`: **test kabini**. Oyunun yerine geçer: eklentiyi oyun gibi yükler,
  ekran dokusunu oluşturup eğik bir kabin ekranında gösterir, host'u kendi adlarıyla başlatır.
  G basılı tut = dokun, Y = yaklaş, F10 = ekran görüntüsü. Açık bir oyunla çakışmaz.
  - `--script plugin\test\cab-v13.txt` ile senaryo çalıştırıp `plugin\build\shots`'a PNG kaydeder.
  - `--marker 1282x794` bir tırın ekranını taklit eder (`shared/screens.json`). Varsayılan kare
    doku genel betiğinkidir.
  - Senaryolar:
    - `cab-v5.txt`: uygulama açılış/kapanışı.
    - `cab-v6.txt`: YouTube'a tıklama ve kaydırma.
    - `cab-v13.txt`: 1.0'ın genel denemesi. Tekerlekle sayfa, ray, arama ve hedef, konvoy,
      YouTube Music, Esc ile durma ve ses.
    - `cab-v14.txt`: konvoy paneli.
    - `cab-v15.txt`: ses sürgüsü ve uzun şarkı adları.
    - `cab-v16.txt`: HUD; oyunun görüntüsü üstünde, üstte/altta, açık/koyu.
    - `cab-v20.txt`: rotanın her dönüşü yukarıdan, talimatıyla birlikte (dönüşleri yollarla
      karşılaştırmak için).
    - `cab-v22.txt` (`--advisor` ile): ön cam göstergesi, F3 paneli, Müzik sekmeleri, ses paketi.
    - `cab-v23.txt` (`--advisor` ile): ön cam göstergesi ve kartın ona yer vermesi.
  - `--advisor`: rota danışmanının TruckPlay paneli dokusunu da oluşturur; `advisor <ad>` adımı
    eklentinin ona çizdiğini kaydeder.
- `host\tools\snap.mjs`: arayüzü oyunun aldığı yoldan (Electron ekran dışı) çizip PNG kaydeder.

| Klasör | İçerik |
| --- | --- |
| `ui/` | React 19 + Motion + MapLibre arayüz. `src/design` (token'lar, cam, yaylar), `src/shell` (kabuk), `src/apps`, `src/maps` (harita; `nav.ts` yol ağı üzerinde rota ve dönüşler), `src/hud` (HUD sayfası, `hud.html`) |
| `host/` | Electron host: ekran dışı çizim, paylaşımlı bellek, pipe, müzik kütüphanesi, harita verisi, reklam engelleyici (`adblock.js`), oyun kayıtlarını okuma (`saves.js`), HUD pencereleri (`hud.js`: kart ve ön cam) |
| `plugin/` | C++ SCS SDK eklentisi: telemetri, D3D11 Present/CreateTexture2D kancaları, kabin kamerasını anlama, girdi, 2D panel, ön cam göstergesi, F3 paneli. `media/`: Windows medya oturumları, Spotify'ı başlatma ve ses düzeyi. `setup/`: kurulum programı |
| `mod/` | Mod derleyici: kabin modellerinden ekranları ölçer (`lib/models.mjs`, `lib/screens.mjs`), GPS betiklerini, dokuları, kabin tanımlarını ve rota danışmanının TruckPlay panelini üretir (HashFS v2 okuyucu `tools/scs`) |
| `map/` | Harita verisi: şehir tablosu, yol ağı (`build-graph.mjs`; sektör okuyucu `lib/sector.mjs`, kavşak okuyucu `lib/ppd.mjs`), demo rotası, MVT okuyucu |
| `shared/` | Ekran tablosu (`screens.json`, mod derleyici yazar), sesli yönlendirmenin cümleleri (`voice.json`), protokol, PMTiles okuyucu |
| `scripts/` | Geliştirici kurulumu (`kur.ps1`), eklenti derleme, tek dosya kurulum (`paket.mjs`, `package/setup.ps1`), ses paketi üretici (`voices.mjs`) |
| `voices/` | Ses paketleri (`voices.mjs` üretir; yoksa Windows sesi konuşur) |

## Neden Electron?

TruckPlay'in oyunun içinde çalışan kısmı, yani eklenti, C++ ile yazılı. Kararlılığın asıl önemli
olduğu yer orası, çünkü oyunla aynı süreçte çalışıyor. Arayüzün ise gerçek bir web tarayıcısına
ihtiyacı var: YouTube videoları, herhangi bir site, WebGL harita. Bunları pencere açmadan doğrudan
bir dokuya çizebilen tek olgun motor Chromium. Windows'ta bunun iki yolu var: Electron ya da CEF
(Electron'un altındaki parça).

Rust'ın web tarafındaki seçenekleri (Tauri, wry) Windows'un WebView2 motorunu kullanır. WebView2
ekran dışına çizemez, yani görüntüyü oyunun ekranına aktaramaz. CEF'in Rust bağlamaları da henüz
olgun değil.

Electron burada telefonun yerini tutar. Oyundan ayrı bir süreçtir: çökse bile oyun çalışmaya devam
eder ve eklenti onu yeniden başlatır. Paket hâlinde Node.js ya da başka bir kurulum gerektirmez.

## Teşekkür ve lisanslar

- Harita döşemeleri ve arama dizini [truckermudgeon/maps](https://github.com/truckermudgeon/maps)
  projesinin yayımladığı verilerdir; yol ve şehir verisi SCS Software'e aittir. Kurulumda indirilir,
  modla dağıtılmaz.
- SCS Telemetry SDK © SCS Software.
- Oyunun harita ve kavşak dosya biçimleri için topluluğun notları: sk-zk/map-docs,
  dariowouters/ts-map, truckermudgeon/maps. Okuyucular (`map/lib`) bu notlardan bağımsız yazıldı;
  kod alınmadı.
- Inter yazı tipi (SIL OFL), MapLibre GL JS (BSD-3), Ghostery adblocker (MPL-2.0). Reklam filtresi listeleri (EasyList, uBlock Origin) çalışırken
  indirilir, paketle dağıtılmaz.
- Apple, CarPlay ve SF Symbols Apple Inc.'in markalarıdır. TruckPlay'in ikonları, glifleri ve duvar
  kâğıtları özgündür, Apple varlığı içermez.

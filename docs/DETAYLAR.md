# TruckPlay: ayrıntılar

Kurulum ve kısa tanıtım: [README](../README.md). Bu sayfa her şeyin nasıl çalıştığını, uygulamaları
tek tek, bilinen sınırları ve geliştirici notlarını anlatır.

## Kurulum dosyası ne yapar

1. TruckPlay'i `%LOCALAPPDATA%\TruckPlay` klasörüne kurar.
2. Oyun eklentisini (`truckplay.dll`) oyunun `bin\win_x64\plugins` klasörüne koyar.
3. Modu (`truckplay.scs`) oyuncunun kendi oyun dosyalarından üretir ve
   `Belgeler\Euro Truck Simulator 2\mod` klasörüne koyar. Her tırın ekranı ayrı ölçülür, sahip
   olunan DLC tırları da dahil.
4. Harita verisini indirir (~115 MB, bir kere): oyunsuz deneme penceresinin haritası ve yer adları
   için. Oyundaki harita oyunun kendisinden gelir.
5. Başlat menüsüne ve masaüstüne **TruckPlay (deneme)** kısayolunu koyar (oyunsuz deneme penceresi)
   ve Windows'un uygulama listesine yazılır.

TruckPlay oyunla birlikte kendiliğinden açılır ve oyunla kapanır; ayrıca başlatman gerekmez.

- Oyun güncellenince bir şey yapman gerekmez: TruckPlay oyunun sürümünü eklentiden öğrenir ve sürüm
  değişmişse modu yeni oyundan kendisi yeniden üretir (bildirimle haber verir; yeni mod bir sonraki
  açılışta yüklenir). Mod her 1.x sürümüyle uyumlu işaretlidir, oyun onu "uyumsuz" diye kapatmaz.
  Yine de bir güncellemeden sonra Mod Yöneticisi'nde TruckPlay kapalı görünürse yeniden etkinleştir.
- Kaldırmak için Windows Ayarlar › Uygulamalar › **TruckPlay** › Kaldır, Başlat menüsü › TruckPlay
  › **TruckPlay'i kaldır** ya da `TruckPlay-Kurulum.exe -Uninstall`.
- Oyun bulunamazsa: `TruckPlay-Kurulum.exe -GameDir "D:\Oyunlar\Euro Truck Simulator 2"`.

Neden mod klasörüne atılan tek bir `.scs` yetmiyor? ETS2 kod içeren eklentileri (DLL) yalnız kendi
`bin\win_x64\plugins` klasöründen yükler. Mod klasöründeki dosyalar yalnız oyun içeriği olabilir.
Görüntüyü ekrana taşıyan eklenti ve uygulama olmadan mod tek başına bir şey göstermez. Bu yüzden
dağıtılan şey, hepsini yerine koyan tek bir kurulum dosyasıdır.

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
  Dokununca Denetim Merkezi'ndeki gibi bir ses sürgüsü açılır, tekerlekle de ayarlanır; başka bir
  yere dokununca hemen kapanır. Aynı sürgü Şimdi Çalınan'da da var.
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

### Çözünürlük

Ayarlar › Ekran ve Tuşlar › **Çözünürlük**: arayüz kabin ekranının kendi boyunda (1×, varsayılan)
ya da 1,5 ve 2 katı piksel çizilir. Düzen aynı kalır, yalnız keskinleşir: en çok Y ile açılan büyük
görünümde ve F3 panelinde fark edilir; kabin ekranı için eklenti büyük kareyi ekranın boyuna
küçültür. Daha çok piksel daha çok iş demek: 2× çoğu bilgisayarda oyunu yavaşlatır (o yüzden 2×'te
arayüz saniyede 30, 1,5×'te 45 kare çizilir). Ayar hemen uygulanır, alt satırda çizilen boyut yazar.
Sayfaların (YouTube, tarayıcı) yakınlaştırması da her yüklemede bu ölçeğe getirilir. Y ile açılan
büyük görünüm, arayüzü oyunun ekranında büyütürken düz çizgiler yerine Catmull-Rom eğrisiyle
örnekler: 1× çözünürlükte de yazılar ve kenarlar bulanıklaşmadan büyür.

## Uygulamalar

- **Gösterge Paneli**: oyunun canlı haritası, sıradaki hedef, çalan müzik ve teslimatın canlı
  etkinliği.
- **Widget'lar**: oyun saati, dinlenme sayacı, yakıt/AdBlue/hız/hasar.
- **Haritalar**: oyunun kendi GPS haritası, canlı ve Apple Haritalar renklerinde. Eklenti, oyunun
  GPS'e çizdiği haritayı oyun çizerken kopyalar (oyun onu dokuda baş aşağı tutar, eklenti
  düzeltir; oyunun GPS'i 3B bir görünümdür: tır ortada, yakın yol altta, ilerisi üste doğru
  daralır); TruckPlay onu Apple'ın boyasıyla yeniden boyar:
  açık temada kâğıt rengi zemin, gri kenarlı beyaz yollar, yeşil alanlar; koyu temada grafit zemin
  ve gri yollar; rota Apple'ın mavisiyle, dönüş okları beyaz. Tırın yerinde Apple'ın beyaz daire
  içindeki mavi oku durur (oyunun kendi oku, ışığı ve gölgesi kaldırılıp altındaki yol tamamlanır).
  Düzen de Apple
  Haritalar'ınki: sol üstte hedef kartı, sağda yakınlaştırma, altta varış saati, süre ve mesafe,
  köşede hız sınırı. Rakamlar oyunun kendi rakamlarıdır. Rayın en üstünde hep sabit durur.
  - Rota, işaretler ve hedef oyunun kendisidir: iş varken varış noktası, yokken oyunun haritasında
    (M) işaretlediğin yer ve ara noktalar; konvoyda oyunun konvoy rotası. Oyunda bir yer işaretleyince
    aynı rota aynı anda burada da çıkar; TruckPlay ayrı bir rota hesaplamaz, dönüşleri kendisi
    çizmez.
  - Nasıl çalışır: oyun haritasını kendine has birkaç düz renkle çizer (`def/map_data.sii`: gördüğün
    yollar sarı, gerisi gri, kavşaklar bej, binalar turuncu, rota siyah kenarlı kırmızı, dönüş okları
    yeşil). Her yeni karede her piksel bu renklerden birine ya da kenarlarda ikisinin karışımına
    oturtulur; böylece hangi pikselin ne kadar yol, rota, bina ya da yeşil alan olduğu çıkar ve
    ekrana temanın renkleriyle, yolların kenar çizgileriyle boyanır (WebGL 2, `ui/src/maps/
    gameMapGl.ts`). Hiçbir renge oturmayan pikseller (oyunun harita ikonları) kendi renginde kalır.
  - Oyun haritasını yumuşatmadan, 1024 × 1024 çizer: yakından (yakınlaştırınca ya da büyük
    görünümde) her eğik kenar piksel basamakları olurdu. Her kenarın yönü bulunur ve paylar o yön
    boyunca (hiç karşıdan karşıya değil) ortalanır; basamaklar düz ya da yumuşak kıvrılan bir çizgiye
    erir, köşeler ve ince çizgiler kalır. Ekrana her karede kübik B-spline ile okunup keskin bir
    kenarla kesilir: her yakınlıkta temiz bir çizgi.
  - Oyunun kendi tır oku haritanın ortasındadır; TruckPlay'in oku onun yerine geçer. Oyunun oku
    (yalnız ortadaki maviye bağlı mavi, okun boyunu aşmadan) bir elipsle alınır ve altı çevresinden
    doldurulur: içinden geçen yollar karşıya devam eder, oradan başlayan rota ortaya kadar uzanır.
    Ara noktanın iğnesi de aynı mavidir ama ayrı durduğu için dokunulmaz (eskiden tıra yaklaşınca
    deliği büyütüp çevreyi boş zeminle kaplıyordu).
  - **3D binalar**: oyunun haritasındaki binalar (gördüğün bina alanları) çatılı bloklar olarak
    yükselir, ufka doğru kısalarak; rota her zaman üstlerinde görünür. Ayarlar › Haritalar › 3D
    binalar ile kapatılır.
  - Dış kameralarda oyun GPS ekranını çizmeyi bırakabilir: harita o zaman oyunun haritayı çizdiği
    yerden alınmaya devam eder (oyun çizmeyi sürdürüyorsa canlı, sürdürmüyorsa son hâli); TruckPlay'in
    eski kendi haritasına geçmez. Oyuna bağlıyken harita daha hiç gelmediyse (kabin görünümüne hiç
    geçilmediyse) bunu söyleyen sade bir bekleme görünümü çıkar.
  - ETS2 dış kamerada GPS ekranını göstermeyi sürdürür ama haritayı yeniden çizmez: o sırada
    haritaya yeni bir yer işaretlenirse rota, kabine (1) geçilince gelir; sonra dış kamerada da
    kalır. Eklenti bunu anlar (oyunun haritayı çizdiği hedefe bakar) ve Haritalar'da "Oyun haritasını
    yalnız kabin görünümünde yeniliyor" satırı çıkar; kabine dönünce kaybolur.
  - Yakınlaştırma düğmeleri haritayı yayla yaklaştırıp uzaklaştırır; hedef kartına dokunmak geniş
    görünümle dönüşümlü çalışır.
  - Oyun yokken (oyunsuz deneme penceresi, geliştirme) TruckPlay'in kendi haritası çıkar: arama,
    yakındaki servisler, yakıt, dinlenme ve garajlar, harita ikonları, Ayarlar › Haritalar.
- **Konvoy**: oyunun kendi konvoy sistemi kullanılır, TruckPlay'in ayrı bir konvoyu yok. Konvoydaki
  ortak iş ve oyunun çok oyunculu rotası Haritalar'a gelir.
- **Müzik** dört sekmeden oluşur ve aynı anda tek şey çalar.
  - **Spotify**: bilgisayardaki Spotify uygulaması (masaüstü ya da Microsoft Store sürümü),
    Apple Music'teki gibi bir oynatıcıda. Solda büyük kapak, şarkı, sürüklenebilen ilerleme
    çubuğu, karıştır/geri/oynat/ileri/tekrarla; arkada kapağın renklerinden yavaşça akan bulanık
    bir zemin. Sağda **şarkı sözleri**: söylenen satır büyük ve kelime kelime aydınlanır, sonraki
    satırlar bulanık bekler, sütun yaylı bir hareketle akar; uzun aralarda üç nokta nefes alır.
    Bir satıra dokunmak şarkıyı oraya götürür. Sözler, açık ve ücretsiz söz veritabanı
    [LRCLIB](https://lrclib.net)'ten gelir (anahtar gerekmez) ve şarkı başına diskte saklanır;
    zamanlanmış söz yoksa düz metin şarkıyla birlikte kayar. Ücretsiz, reklamlı Spotify da olur.
    **Spotify'ı başlat** onu oyunun önüne pencere açmadan, küçültülmüş başlatır ve kaldığı
    şarkıdan çalar. Bilgisayarda başka çalan bir şey varsa (tarayıcı sekmesi) kontrollerin altında
    çip olarak durur.
  - **YouTube Music**: reklam engelleyiciyle, ücretsiz ve reklamsız. Müzik'ten çıkınca da çalmaya
    devam eder.
  - **Radyo**: Türk radyoları ve oyunun radyo listesi.
  - **Kitaplık**: bilgisayardaki müzikler.
- **Tarayıcı**: Safari tarzı; yüzen cam adres çubuğu, öneriler, sekmeler, sık kullanılanlar.
  Sayfadaki yazı alanları klavyeyi alır. Tam ekran video ekranın içinde açılır, geri ile çıkılır.
- **YouTube**: mobil YouTube, üstte küçük cam bir çubukla (geri, arama, ana sayfa, yenile). Video
  tam ekranda kabin ekranını doldurur; Y ile büyük görünümde de oynamaya devam eder. Sayfa
  uygulamadan bağımsız yaşar: Haritalar'a geçip dönünce aynı video aynı saniyeden sürer (yeniden
  yüklenmez); bölünmüş ekranda F3 paneline de böyle geçer.
- **Reklam engelleyici**: tarayıcıda, YouTube'da ve YouTube Music'te. Açık gelir, Ayarlar › Web'den
  kapatılır.
- **Duvar kâğıtları**: hareketli olanlar (Kuzey Işıkları, Sıvı Cam, Işıltı), manzaralar, renkler ve
  oyunda F10 ile aldığın ekran görüntüleri (Ayarlar › Duvar Kâğıdı).
- **Görünüm**: Açık ya da Koyu. Koyu varsayılandır.
- **Tır**: hız, devir, yakıt, sıcaklıklar, hasarlar, ışıklar.
- **Teslimat**: yük, rota, ücret ve teslim saati.
- **Mesajlar** ve **Ayarlar**.
- Ceza, otoyol ücreti, feribot ve teslimat gibi oyun olayları CarPlay bildirimi olarak üstten düşer.

## Rota danışmanında TruckPlay (F3)

F3 ile açılan rota danışmanının paneli (sağ alttaki harita ve durum penceresi) açıkken onun
yerine, tam üstüne TruckPlay ekranının bir kopyası gelir: yolda video izlemek ya da haritaya
bakmak için. Ekran kendi oranıyla (bozulmadan) koyu bir camın ortasında, köşeleri danışmanın
panelleri gibi yuvarlak çizilir; üstte ve altta kalan pay siyah değil, ekranın o kenarındaki
renklerden süzülen yumuşak bir ışıktır. Ayarlar › Rota danışmanı (F3) › **TruckPlay ekranı** ile
açılır; kapalıyken danışman olduğu gibi görünür.

### Bölünmüş ekran

Uygulamalar sayfasındaki **Bölünmüş** simgesi kabin ekranıyla F3 panelini ayırır: kabin ekranında
Haritalar açılır, F3 panelinde YouTube yalnız video olarak, paneli tam dolduracak oranda oynar.
Simge açıkken mavi bir halkayla işaretlidir; ona yeniden dokunmak ya da kabin ekranında YouTube'u
açmak bölmeyi kapatır (video kaldığı yerden kabin ekranına döner). Önce YouTube'da videoyu seçip
sonra Bölünmüş'e dokunmak en rahatıdır. Teknik olarak: host sayfayı panelin payı kadar genişletir,
YouTube sayfası yeniden yüklenmeden o paya kayar, eklenti kabin ekranına sol payı, F3 paneline sağ
payı çizer (`layout` mesajı).

İki ekran yan yana birleşmiş gibidir: G basılıyken imleci kabin ekranının sağ kenarından öteye
sürünce F3 paneline geçer (panelin yüksekliğinde; altından geçilmez) ve orada görünür. Videoya
dokunmak durdurur, yeniden dokunmak oynatır; ortada kısa bir oynat/duraklat işareti belirir.
YouTube'un kendi düğmeleri bu modda gizlidir ve dokunuşları görmez.

## Oyun açılırken ya da kariyere girerken kapanıyorsa

Oyunun `plugins` klasöründeki her eklenti oyunun içinde çalışır; biri çökerse oyun kapanır. Hangisi
olduğu yazılı: `Belgeler\Euro Truck Simulator 2\game.crash.txt` içinde **Fault address** satırının
sonundaki dll.

- **`spf-framework.dll`** (SPF Framework; KujeesLens gibi eklentiler onunla çalışır): oyunun içindeki
  yapıları sürüme özgü desenlerle bulur. Oyun güncellenince eski sürümü yanlış adresten okuyup dünyaya
  girerken çöker. ETS2 1.62 için **1.2.6 ya da sonrası** gerekir (1.2.6'nın notu: "fixes a crash on
  world entry"). Güncelleme:
  [SPF-Framework sürümleri](https://github.com/TrackAndTruckDevs/SPF-Framework/releases), arşivdeki
  her şey oyunun `bin\win_x64\plugins` klasörüne. O zamana kadar oynamak için `spf-framework.dll`'i
  ve `spfPlugins` klasörünü `plugins` dışına taşımak yeter.
- **`truckplay.dll`**: `plugins\truckplay\truckplay.log`'un sonunu ve `game.crash.txt`'yi sakla.

## Bilinen sınırlar

- Spotify'ı reklamsız dinlemenin izinli tek yolu Premium. İstemciyi yamalayan araçlar Spotify'ın
  kullanım koşullarına aykırı olduğu için TruckPlay'de yoktur. Reklamsız müzik için YouTube Music
  sekmesi var.
- uBlock Origin Lite bir Chrome eklentisidir ve Electron'un desteklemediği bir tarayıcı arayüzüne
  (declarativeNetRequest) dayanır. Onun yerine Ghostery'nin reklam engelleme motoru, uBlock Origin'in
  ve EasyList'in filtre listeleriyle ağ isteklerini süzer. YouTube'da reklam verisi ayrıca sayfanın
  içinde temizlenir. Listeler haftada bir yenilenir.
- Haritalar oyunun GPS'inin gösterdiği alanı gösterir (tırın çevresi, oyunun kendi yakınlaştırmasıyla);
  bütün rotayı baştan sona tek ekranda gösteren bir genel bakış yok, çünkü oyun rotanın kendisini
  eklentilere vermez. Oyunun GPS'i hız arttıkça kendisi uzaklaşır.
- Şarkı sözleri LRCLIB'de olan şarkılar için çıkar; olmayanlarda "sözler bulunamadı" yazar.
- TruckPlay oyunun M haritasına işaret koyamaz: oyun buna izin veren bir yol açmıyor. Konvoyda
  kurucunun işaretlerini oyun herkese dağıtıyorsa TruckPlay'de de görünür; dağıtmıyorsa ortak iş
  ve kişinin kendi işaretleri görünür.
- Oyunun haritasını Apple renklerine çevirmek oyunun kendi renklerine dayanır. Bir mod GPS
  renklerini değiştirmişse o renkler tanınmaz ve harita kısmen oyunun renginde kalır.

## Geliştirme

### Nasıl çalışır

```
oyun (eurotrucks2.exe)                       bilgisayar
┌───────────────────────────────┐   pipe     ┌────────────────────────────────┐
│ plugin/truckplay.dll          │◄──────────►│ host/ (Electron, ekran dışı)   │
│  telemetri, D3D11 kancaları,  │ paylaşımlı │  ui/ (React) kareleri çizer,   │
│  fare/klavye, "yaklaş" paneli │◄═══════════│  girdiyi arayüze iletir        │
└───────────────────────────────┘   bellek   └────────────────────────────────┘
mod/ → truckplay.scs: GPS ekran betiklerini TruckPlay'in dokusunu çizecek şekilde değiştirir
```

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

### Kurulum dosyası ve sürüm yayımlama

Kurulum dosyasını üretmek için `node scripts/paket.mjs` çalıştırılır. Sonuç
`dist\TruckPlay-Kurulum.exe` olur (~150 MB). `--skip-build` derlemeyi atlar. Steam Atölyesi
gerekmez; istenirse `--workshop` modu Atölye klasörü olarak da üretir (`dist\workshop\`, adımlar
`ATOLYE.txt`'de).

Yeni bir sürüm GitHub'da **Releases** olarak yayımlanır, tek dosya olarak:

```bash
node scripts/paket.mjs
gh release create v1.7.0 dist/TruckPlay-Kurulum.exe --title "TruckPlay 1.7.0" --notes-file notlar.md
```

Dosyanın adı hep `TruckPlay-Kurulum.exe` kalır; README'deki indirme bağlantısı
(`releases/latest/download/TruckPlay-Kurulum.exe`) böylece her zaman en yeni sürümü indirir.

### Arayüz

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
    - `cab-v25.txt`: Haritalar'da oyunun haritası (test kabininin uydurma GPS haritası).
    - `cab-v26.txt` (`--advisor` ile): F3 paneli, Haritalar açılırken raydaki ikon, ayarlar.
    - `cab-v27.txt`, `cab-v28.txt`: Spotify oynatıcısı ve sözler (uydurma bir oturumla), Müzik
      sekmeleri, raydan uygulama geçişi, büyük görünüm.
    - `cab-v29.txt`: oyunun haritası Apple renklerinde; Haritalar koyu, yakın, uzak, açık, büyük
      görünüm ve pano kartı.
    - `cab-v30.txt`: video. YouTube'da bir video oynar (saati günlüğe yazılır), tam ekrana geçer,
      üstüne büyük görünüm açılır.
    - `cab-v31.txt` (`--baremap` ile): oyundan alınmış haritayla Haritalar doğru yönde, 1× ve 2×
      çözünürlükte; 2×'te büyük görünüm ve imleçle tıklamanın tam hedefe düştüğü (günlükte `hits`).
    - `cab-v32.txt` (`--advisor --baremap` ile): GPS çizimi dursa da (`gps off`) haritanın kaldığı,
      ses sürgüsünün başka yere dokununca kapandığı, YouTube'un uygulama değişince yeniden
      yüklenmediği, bölünmüş ekran (kabinde Haritalar, F3 panelinde video).
    - `cab-v33.txt` (`--baremap` ile): 3D binalar, koyu ve açık.
    - `cab-v34.txt` (`--advisor --window 2560x1440 --baremap` ile): tırın yanında ara nokta
      iğnesiyle harita (delik okun boyunda kalır), yakında ve 1440p'de büyütülen büyük görünümde
      yumuşak kenarlar, dış kamera (`gps still`) ve ipucu satırı, bölünmüş ekranda imlecin F3
      paneline geçmesi ve videoya dokununca durup yeniden oynaması (günlükte `video paused`).
  - `--window 2560x1440`: oyunun penceresi (varsayılan 1600x900); büyük görünüm ancak oyunun ekranı
    arayüzden büyükken büyütür.
  - `gps on|off|still`: GPS ekranı çizilir, çizilmez, ya da çizilir ama haritası yeniden çizilmez
    (oyunun dış kamerada yaptığı gibi).
  - `--advisor`: rota danışmanının TruckPlay paneli dokusunu da oluşturur; `advisor <ad>` adımı
    eklentinin ona çizdiğini kaydeder.
  - Test kabini oyunun GPS zincirini taklit eder: oyunun renkleriyle uydurma bir GPS haritasını ayrı
    bir dokuya çizer, onu ve TruckPlay dokusunu ekranın render hedefine, kabin ekranı da o hedefi
    gösterir. Böylece oyunun haritasını yakalama ve kabin görünümünü anlama burada da sınanır.
  - `--baremap <dosya>`: uydurma harita yerine oyundan alınmış bir haritayı gösterir. Eklenti her
    oturumda haritayı bir kez kendiliğinden diske yazar (`plugins\truckplay\bare-map.bin`, rota
    varken bir kez daha `bare-map-route.bin`); aynı klasöre `dump-map` adlı bir dosya koymak da yeni
    bir döküm alır.
- `host\tools\snap.mjs`: arayüzü oyunun aldığı yoldan (Electron ekran dışı) çizip PNG kaydeder.

| Klasör | İçerik |
| --- | --- |
| `ui/` | React 19 + Motion + MapLibre arayüz. `src/design` (token'lar, cam, yaylar), `src/shell` (kabuk), `src/apps`, `src/maps` (oyunun haritası: akış `gameMapFeed.ts`, Apple boyası `gameMapGl.ts`; oyunsuz kendi haritası `GameMap.tsx`) |
| `host/` | Electron host: ekran dışı çizim, paylaşımlı bellek, pipe, müzik kütüphanesi, harita verisi, reklam engelleyici (`adblock.js`), oyun kayıtlarını okuma (`saves.js`), oyunun haritasının akışı (`mapfeed.js`), şarkı sözleri (`lyrics.js`), oyun güncellenince modu yeniden üretme (`modcheck.js`) |
| `plugin/` | C++ SCS SDK eklentisi: telemetri, D3D11 Present/CreateTexture2D kancaları, oyunun çizdiklerini izleme (`gamedraw.cpp`: kabin görünümü, oyunun GPS haritası ve akışı), girdi, 2D panel, F3 paneli. `media/`: Windows medya oturumları, Spotify'ı başlatma ve ses düzeyi. `setup/`: kurulum programı |
| `mod/` | Mod derleyici: kabin modellerinden ekranları ölçer (`lib/models.mjs`, `lib/screens.mjs`), GPS betiklerini, dokuları, kabin tanımlarını ve rota danışmanının TruckPlay panelini üretir (HashFS v2 okuyucu `tools/scs`) |
| `map/` | Harita verisi: şehir tablosu, demo rotası, MVT okuyucu |
| `shared/` | Ekran tablosu (`screens.json`, mod derleyici yazar), protokol, PMTiles okuyucu |
| `scripts/` | Geliştirici kurulumu (`kur.ps1`), eklenti derleme, tek dosya kurulum (`paket.mjs`, `package/setup.ps1`) |

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
- Şarkı sözleri: [LRCLIB](https://lrclib.net), açık ve ücretsiz söz veritabanı (çalışırken sorulur,
  paketle dağıtılmaz).
- Inter yazı tipi (SIL OFL), MapLibre GL JS (BSD-3), Ghostery adblocker (MPL-2.0). Reklam filtresi listeleri (EasyList, uBlock Origin) çalışırken
  indirilir, paketle dağıtılmaz.
- Apple, CarPlay ve SF Symbols Apple Inc.'in markalarıdır. TruckPlay'in ikonları, glifleri ve duvar
  kâğıtları özgündür, Apple varlığı içermez.

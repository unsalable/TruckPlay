# TruckPlay HUD: plan

Amaç, sürücünün dönüşleri kaçırmaması. Yolun üstünde, gözün önünde duran sade bir gösterge:
sıradaki manevra, ona kalan mesafe, hız ve hız sınırı. Görünüm ve hareket Apple Haritalar'ın yol
tarifi kartı gibi.

## Durum (1.1)

Önerilen yol izlendi: veri A seçeneği, çizim ekran katmanı. Yapılanlar şunlar:

- **H0–H1 Yol ağı.** Kurulum, oyunun kendi harita dosyalarını okuyup yol ağını üretir
  (`map/build-graph.mjs`, `map/lib/sector.mjs`, `map/lib/ppd.mjs`).
  - Okunan veriler: sektörler (biçim 907), kavşak tanımları (biçim 25), yol tipleri ve feribot
    hatları.
  - ETS2 1.61'de 1101 sektör ~4 saniyede, hatasız okunuyor. Sonuç: 200 bin düğüm, 114 bin yol,
    52.700 kavşak, 129 feribot/tren hattı; 9 MB.
  - Rota A* ile hesaplanıyor (`ui/src/maps/nav.ts`).
  - Talimatlar kavşakların gerçek şerit eğrilerinden çıkıyor. Ana yol ile rampa şerit sayısından
    ayrılıyor.
  - Dönel kavşaklarda çıkışlar sayılıyor: tek parça halkalar adından, parçalı halkalar grafta
    dolaşılarak bulunuyor.
- **H2 Arayüz.** `ui/hud.html` ve `ui/src/hud/` kartı çiziyor:
  - kayan mesafe rakamları, kendini çizen ok, yaklaşma çizgisi;
  - "Şimdi" anında mavi karo, "Sonra" çipi;
  - hız ve sınır, açık ve koyu tema.
- **H3 Bindirme.** Host ikinci bir ekran dışı pencere açıyor (`host/src/hud.js`), kareler ayrı bir
  paylaşımlı bellekten akıyor. Eklenti kartı `Present`'te saydam olarak çiziyor. Esc menüsünde,
  duraklatmada ve "yaklaş" ekranında çizmiyor.
- **H4 (kısmen).** Dönüşte çan çalıyor. İsteğe bağlı Türkçe sesli yönlendirme var (Windows'un
  Microsoft Tolga sesi). Ayarlar'dan konum (üst/alt), boyut ve ses seçilebiliyor.

## Durum (1.2)

- **Ön cam göstergesi.** Üçüncü bir ekran dışı pencere (`hud.html?view=wind`) gerçek bir HUD gibi
  yalnız ışık çizer: hız, sınır, hız sabitleyici, sıradaki dönüş. Eklenti onu kabine sabit bir
  noktaya (göz noktasının 2,4 m önü, birkaç derece altı) SDK'nın kafa konumu ve yönüyle yerleştirir.
  Yalnız kabin kamerasında görünür: kabin ekranının render hedefinin örneklenmesi izlenir. Orada
  kartın yerini alır.
- **Rota Danışmanı (F3).** Mod, danışmanın yığınının en üstüne bir panel ekler; eklenti kabin
  ekranını oraya kendi oranıyla çizer.
- **Ses.** Cümleler `shared/voice.json`'da; doğal ses paketi (`scripts/voices.mjs`, Google/Azure
  ücretsiz kota) varsa o, yoksa Windows sesi okur. Kadın/erkek seçimi, "ardından" zinciri.
- Hedef artık yalnız oyundan gelir (iş ya da M haritasındaki işaretler ve ara noktaları); ara
  noktalardan geçen rota hesaplanır.

Kalanlar:
- şerit yönlendirmesi;
- yön tabelalarındaki şehir adlarını talimata katmak ("Çıkış · Edirne");
- oyunun kamera görüş açısını (FOV) okumak.

Plan aşağıda olduğu gibi duruyor.

## 1. Ne gösterecek

Sürüş sırasında tek bakışta okunacak üç katman var.

1. **Manevra kartı** (ana öğe):
   - Büyük dönüş oku: sola, sağa, hafif, keskin, şeritte kal, ayrıl, kavşakta n. çıkış, U dönüşü,
     feribot/tren, varış.
   - Geri sayan mesafe: "800 m", "300 m", "Şimdi".
   - Yolun adı ya da çıkış: "Çıkış 23 · E80 İstanbul", yol kalkanıyla.
2. **"Sonra" çipi**: iki manevra arası kısaysa (< 400 m) ikincisi de küçük gösterilir
   ("sonra sağa").
3. **Alt şerit**: hız, hız sınırı tabelası (aşınca kırmızıya döner), varış saati ve kalan km.

Şerit yönlendirmesi (hangi şeritte olmalı) isteniyor ama veri kaynağına bağlı (bölüm 2). İlk
sürümde yok, ikinci adımda gelir.

## 2. Veri: manevralar nereden gelecek

Oyunun SDK'sı rota hakkında yalnız varışa kalan mesafeyi, süreyi ve hız sınırını veriyor. Oyunun
kendi rotası ve dönüşleri dışarı verilmiyor. Bugün Haritalar'daki mavi çizgiyi TruckPlay kendisi
hesaplıyor (`ui/src/maps/routeWorker.ts`). Harita döşemelerindeki yol çizgilerini birleştirip
üzerinde yol arıyor. Çizgi için bu yeterli, dönüş tarifi için yetersiz:

- Kavşak ve kavşak içi bağlantılar (prefab şeritleri) döşemelerde yok. Hangi şeridin hangi yola
  bağlandığı bilinmiyor.
- Bu yüzden karmaşık otoyol kavşaklarında yanlış "sağa dön" çıkabilir.

Seçenekler:

| Seçenek | Ne | Artı | Eksi |
| --- | --- | --- | --- |
| **A. Oyunun yol ağını okumak** | Kurulumda oyun dosyalarından (harita sektörleri + prefab tanımları) şerit düzeyinde bir yol grafiği üretmek. Mod derleyicinin HashFS okuyucusu zaten var (`tools/scs`). | Oyunun gerçek bağlantıları: doğru dönüşler, şerit bilgisi, her oyun sürümüyle uyumlu. Kendi kodumuz. | En büyük iş: sektör ve prefab biçimlerini çözmek (truckermudgeon/maps bunu yapıyor, GPL-3; kod kopyalanmaz, biçim bilgisi referans alınır). |
| B. Döşemelerden çıkarım | Bugünkü graf + kavşaklarda açıdan manevra çıkarmak | Hızlı | Kavşaklarda güvenilmez; "dönüşleri kaçırmayalım" hedefini karşılamaz. |
| C. Hazır graf verisi | truckermudgeon'ın yayımladığı bir graf varsa onu indirmek (döşemeler gibi) | Az iş | Herkese açık bir dosya olarak yayımlanıp yayımlanmadığı, sürümü ve lisansı doğrulanmalı. |

**Önerim A.** Önce bir günlük araştırmayla C'nin olup olmadığına bakılır, varsa ilk sürüm onunla
çıkar, A arkadan gelir. B yalnız A/C yoksa geçici çözümdür.

Grafın üstünde yapılacaklar:

- Rota: A* araması. Tır maliyetleri: otoyolu tercih et, şehir içi ve feribot cezalı, yasak
  yönler kapalı.
- Hedef: Haritalar'daki hedef sırası aynen kullanılır (konvoy, kendi seçimin, iş, oyunda
  işaretlenen rota).
- Takip: tır konumu rotaya oturtulur. Rotadan çıkınca 1 saniye içinde yeniden hesaplanır ve kart
  "Yeniden hesaplanıyor" der.
- Manevra üretimi: her kavşakta giriş ve çıkış şeridinin açısı, şerit sayısı ve yol sınıfı
  değişiminden tür çıkarılır (hafif/keskin dönüş, ayrılma, kavşak çıkışı).
- Oyunun kendi GPS'iyle uyum: oyunun rotası okunamadığı için bizimki bazen farklı yoldan gidebilir.
  Maliyetler oyunun tercihlerine (otoyol ağırlıklı) yakın tutulur. Haritadaki mavi çizgi ve HUD
  aynı rotayı gösterir, sürücü hangisini izlediğini bilir.

## 3. Çizim: HUD ekrana nasıl gelecek

Üç yol var:

1. **Ekran katmanı (önerim).** Eklenti, oyunun her karesinde (Present) "Yaklaş" panelini zaten
   çiziyor. HUD aynı yoldan, ikinci bir doku olarak çizilir. İçeriği host'taki ikinci bir ekran
   dışı Electron penceresi üretir: React + Motion, arayüzle aynı tasarım dili. Kare yalnız değişince
   gönderilir, saydamlık korunur (premultiplied BGRA).
   - Konum ayarlanabilir: üst orta (ön cam hissi) ya da göstergenin üstü.
   - Oyun menüsünde, haritada, fotoğraf modunda ve kabin dışı kamerada gizlenir. Esc/duraklatma
     bilgisi bugün zaten var.
   - Hedef maliyet: kare başına < 0.3 ms. Hareketsizken saniyede 2 kare, animasyonda 60 kare.
2. **Rota Danışmanı'nın yerine.** Sağ alttaki oyun paneline, kabin ekranındaki gibi işaretli bir
   doku konur. Oyun onu kendi arayüz katmanında çizer, menülerde kendisi gizler. Alan küçük (~400×250)
   ve oyunun arayüz betiklerine bir yama daha gerekir. İkinci seçenek olarak kalır.
3. **Ön camda gerçek HUD.** Her kabin modeline camın üstünde bir yüzey eklenir, görüntü bakışla
   birlikte hareket eder. En gerçekçisi ama her tır için model düzenlemesi demek. Şimdilik dışarıda.

## 4. Tasarım ve hareket

Apple Haritalar'ın sürüş kartı örnek alınır, kopyalanmaz. Yeni CarPlay kartları gibi koyu cam
zemin, büyük tabular rakamlar ve kendi ok glifleri kullanılır.

- **Yaklaşma**: mesafe her 10 m'de yuvarlanarak değişir. 300 m'de kart hafifçe büyür ve altında
  ince bir ilerleme çizgisi dolmaya başlar. 50 m'de ok bir kez "nefes alır" (yay, aşma yok).
  "Şimdi" anında kart vurgu rengine döner.
- **Geçiş**: manevra geçilince kart yukarı kayıp söner, sıradaki aşağıdan yerine oturur
  (Apple'ın `snappy` yayı, ~350 ms). Ok bir türden ötekine dönerek geçer (morph), atlamaz.
- **Uyarı**: kaçırılmaması için ses de var. Yaklaşırken kısa bir çan çalar. İstenirse Türkçe sesli
  yönlendirme olur, Windows'un yerleşik sesiyle: "800 metre sonra sağdan çıkış".
- **Gece/gündüz**: oyun saati ve farlara göre parlaklık. Gece daha soluk.
- **Az hareket** seçeneği: animasyonlar yerine yumuşak geçişler.
- Hız sınırı aşılınca alt şeritteki tabela kısa bir titreşimle kırmızıya döner.

## 5. Ayarlar

- HUD: açık/kapalı.
- Konum: üst orta / gösterge üstü / Rota Danışmanı.
- Boyut.
- Sesli yönlendirme: açık/kapalı. Uyarı çanı.
- Uyarı mesafeleri: otoyolda 2 km / 800 m / 300 m, şehirde 300 m / 100 m.

## 6. Aşamalar

| Aşama | İş | Bitiş ölçütü |
| --- | --- | --- |
| H0 Araştırma | C seçeneğinin varlığı. Sektör/prefab biçiminin incelenmesi. Present'te ikinci doku çizim denemesi. | Veri yolu kararı; test kabininde saydam bir kutu |
| H1 Yol ağı | Kurulumda graf üretimi (A ya da C). Rota, takip, manevra üretimi. Birim testleri. | Demo sürüşte (İstanbul → Edirne) doğru manevra listesi |
| H2 HUD arayüzü | İkinci ekran dışı pencere. Kart, çip, alt şerit, animasyonlar. Demo modu. | Test kabininde ekran görüntüleriyle doğrulama |
| H3 Oyuna bindirme | Eklentide ikinci paylaşımlı kare, saydam çizim, menü/harita/kamera gizleme. Ayarlar. | Test kabininde kare süresi ölçümü, oyunda deneme |
| H4 Ses ve cila | Çan, Türkçe sesli yönlendirme. Şerit bilgisi (A ile). Son cila. | Oyunda gerçek bir teslimat boyunca hiçbir dönüşün kaçmaması |

## 7. Riskler

- **Rota oyununkinden farklı olabilir.** Maliyet ayarı ve hızlı yeniden hesaplama ile azaltılır.
  Tam çözümü oyunun rotasını okumak, ama SDK bunu vermiyor.
- **Diğer eklentilerle çizim sırası.** SPF, KujeesLens ve CamHub da Present'e bağlanıyor. "Yaklaş"
  paneli bugün bunlarla çalışıyor, HUD de aynı yoldan gider.
- **Oyun sürümü değişince harita biçimi değişebilir.** Graf her kurulumda oyunun kendi
  dosyalarından üretilir. Biçim değişirse araç hata verir ve HUD kapanır, oyun etkilenmez.

## 8. Senin kararın gereken sorular

1. HUD nerede dursun: ekranın üst ortasında (ön cam hissi), Rota Danışmanı'nın yerinde, ya da
   ikisi de seçilebilir olsun?
2. Sesli yönlendirme (Türkçe) olsun mu, yoksa yalnız çan mı?
3. Veri: yol ağını oyunun dosyalarından kendimiz mi okuyalım (daha uzun, en doğru), yoksa önce
   hazır bir kaynakla mı başlayalım?

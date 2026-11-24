# Kick VOD Kaldığın Yer

Kick'te eski yayınları (VOD) izlerken kaldığın dakikayı otomatik kaydeden ve
o yayına tekrar girdiğinde direkt o dakikadan başlatan Chrome eklentisi.

## Özellikler

- `kick.com/<kanal>/videos/<id>` sayfalarında izleme konumunu **5 saniyede bir**,
  ayrıca durdurduğunda ve sekmeyi kapattığında/değiştirdiğinde kaydeder.
- Aynı yayını tekrar açtığında otomatik olarak kaldığın yere atlar ve
  ekranın sol altında "Kaldığın yerden devam: 1:23:45 — **Baştan başla**" bildirimi gösterir.
- Yayının son 30 saniyesine geldiysen "izlendi" olarak işaretler, bir dahaki sefere baştan başlar.
- URL'de zaman parametresi (`?t=...`) varsa ona dokunmaz.
- Eklenti simgesine tıklayınca kayıtlı tüm yayınları ilerleme çubuğuyla listeler;
  tıklayarak açabilir, tek tek veya toplu silebilirsin.
- Kick sayfa yenilemeden video değiştirdiğinde (SPA geçişleri) de doğru çalışır.
- Veriler sadece tarayıcında (`chrome.storage.local`) tutulur, hiçbir yere gönderilmez.
  En fazla 500 yayın saklanır, en eskiler otomatik silinir.

## Kurulum

1. Bu repoyu indir (Code → Download ZIP) ve zip'i aç, ya da `git clone` yap.
2. Chrome'da `chrome://extensions` adresine git.
3. Sağ üstten **Geliştirici modu**nu aç.
4. **Paketlenmemiş öğe yükle** butonuna tıkla ve repodaki `extension` klasörünü seç.
5. Kick'te bir eski yayın aç, izlemeye başla. Bu kadar.

> Edge, Brave, Opera gibi Chromium tabanlı tarayıcılarda da aynı şekilde çalışır.

## Dosyalar

| Dosya | Görevi |
| --- | --- |
| `extension/manifest.json` | Eklenti tanımı (Manifest V3, sadece `storage` izni) |
| `extension/content.js` | Kick sayfasında çalışır: konumu kaydeder ve geri yükler |
| `extension/popup.*` | Simgeye tıklayınca açılan kayıt listesi |
| `extension/icons/` | Simgeler |

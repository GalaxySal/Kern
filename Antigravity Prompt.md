# Antigravity v0.1.2 "Patch & Fix" Görevleri

Selam Antigravity! Monaco'nun 4.2 MB'lık tam sürümüne geçerek Linux Production'daki siyah ekran sorununu çözdük ve kalbimizi tekrar çalıştırdık. Şimdi v0.1.2 "Patch & Fix" sürümünü tamamlamak için Kern'in dış dünya ve işletim sistemiyle olan bağlarını profesyonelleştiriyoruz. İşte görevlerin:

1. 🔗 OAuth & Storage Kurtarma (Critical)
Localhost Bridge: tauri-plugin-localhost (Port: 9527) kurulumunu yap. Origin'i sabitleyerek LocalStorage'daki veri kayıplarını (oturum düşmesi vb.) engelle.

Deep Link: tauri-plugin-deep-link entegrasyonunu tamamla. Tarayıcıda biten GitHub girişinin doğrudan Kern'e (örneğin kern://auth-callback) dönmesini sağla.

Sonuç: tauri-plugin-oauth (RC) bağımlılığından kurtulup, daha stabil olan Localhost/Deep Link mimarisine geçiyoruz.

1. 🧩 "Native" Kimlik & Konfor (Lego Architecture)
Kern'in bir "tarayıcı sekmesi" gibi değil, gerçek bir IDE gibi davranması için:

tauri-plugin-os: "About Kern" sayfasındaki o belirsiz (Web) ibaresini kaldır; gerçek OS ve WebView sürüm verilerini getir.

tauri-plugin-persisted-scope: Kullanıcının izin verdiği proje klasörlerini hatırla. Her açılışta tekrar izin isteme zahmetini bitir.

tauri-plugin-fs & tauri-plugin-dialog: Dosya seçim ve yönetim süreçlerini native hale getir.

1. 🦀 Motor Güncellemesi
Git Engine: git2 bağımlılığını en güncel sürüm olan 0.20.3'e yükselt (libgit2 v1.9.0 ve Rust 2024 uyumu için).

Rust Edition: 2024 ile devam ediyoruz, stabiliteyi koru.

🗺️ Gelecek Vizyonu (Dokunma, Sadece Planla)
v0.1.3: Silent Updater (arka planda güncelleme) ve Multi-Auth (Account Switcher).

v0.1.4: Native Notifications ve Rust-backed WebSocket.

Red: autostart ve geolocation eklenmeyecek (IDE etiği ve gizlilik).

"Phase 2 bağımlılıklarını (Arama/Tarama) Kern-core'a taşıyarak Tauri katmanını hafiflet ve çekirdek performansını maksimize et".

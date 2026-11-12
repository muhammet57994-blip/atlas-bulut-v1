# ATLAS yedek geri yükleme tasarımı

Tarih: 2026-11-08  
Durum: Tasarım notu; uygulama ve üretim verisi değişikliği yapılmadı.

## Mevcut davranış

- `src/backup.js` yalnızca JSON, CSV ve ICS dışa aktarıyor. JSON biçimi `formatVersion: 1` ve `restoreSupported: false` içeriyor.
- JSON yedek 14 kayıt grubunu, arşivleri ve beyan edilmiş fatura ödemelerini içeriyor. Kimlik bilgileri, oturumlar, Instagram bağlantı bilgileri ve işlem geçmişleri dışarıda.
- Dışa aktarma alanları açık listelerle seçiliyor, tek atomik D1 batch okuması kullanıyor ve dosya boyutunu 4 MiB ile sınırlıyor.
- `test/backup.test.js` kapsamındaki 11 test dışa aktarma güvenliğini doğruluyor. Geri yükleme işlevi ve geri yükleme testleri yok.
- CSV ve ICS seçilmiş verileri taşımak için biçimlendirilmiştir; tam ATLAS geri yükleme kaynağı olarak kabul edilmemelidir.

## Güvenli ilk sürüm için öneri

İlk geliştirme yalnızca **doğrulama ve önizleme** olsun. Kullanıcı dosya seçtiğinde hiçbir kayıt yazılmadan şu kontroller yapılmalı:

1. Yalnızca ATLAS JSON biçimi ve desteklenen `formatVersion` kabul edilsin. Dosya 4 MiB sınırını aşarsa okunmadan reddedilsin.
2. Üst nesne ve her kayıt için tam alan izin listesi uygulansın. Bilinmeyen alanlar sessizce atılmasın; dosya reddedilip kullanıcıya neden gösterilsin.
3. Tür, uzunluk, enum, tarih, para birimi, güvenli tamsayı, dizi üst sınırı, benzersiz kimlik ve kayıtlar arası ilişki kontrolleri yapılsın. Parolalar, oturumlar veya bağlantı sırları içeren alanlar hiçbir zaman kabul edilmesin.
4. Önizleme; dosya tarihi/formatı, her gruptaki geçerli kayıt sayısı, çakışma ve hata sayısını göstersin. Ham kayıt metni varsayılan olarak ekrana dökülmesin.
5. Bu aşamada “İçe aktar” düğmesi bulunmasın. Önizleme salt okunur kalsın; doğrulanmamış dosya hiçbir ağ isteğine veya modele gönderilmesin.

## Yazma aşamasına geçmeden önce gerekenler

Geri yükleme yazımı ayrı bir sürüm olarak tasarlansın ve testlerle kanıtlansın:

- İlk yazma modu yalnızca **eklemeli birleştirme** olsun. Mevcut kayıt güncellenmesin veya silinmesin; kimlik çakışması ya birebir aynı kayıt olarak raporlansın ya da tüm işlem yazmadan durdurulsun.
- Kullanıcı önizlemeden sonra kapsamı ve etkilenecek kayıt sayılarını açıkça onaylasın. Kısa ömürlü imzalı onay, dosya özetine (hash), seçilen gruplara ve mevcut veri revizyonuna bağlansın.
- Onaydan hemen önce kapasite, çakışma ve revizyonlar yeniden kontrol edilsin. Kontrol ile yazım D1’in atomik batch işleminde güvence altına alınsın; herhangi bir hata tüm içe aktarımı geri alsın.
- İçe aktarılan her kayıt için kaynak yedek kimliği ve geri alma kaydı tutulsun. Geri alma, aradan geçen değişiklikleri ezmemeli; değişmiş kayıt varsa durmalı ve yeni önizleme istemeli.
- “Tümünü değiştir”, kalıcı silme, kimlik bilgisi içe aktarma ve CSV/ICS’ten tam geri yükleme ilk sürümün dışında kalsın.
- Sınıra yakın dosyalar, yinelenen kimlikler, bozuk/ek alanlı JSON, ilişkisi olmayan kayıtlar, eş zamanlı değişiklik, kapasite doluluğu, yarıda kalan batch ve tekrar gönderim için hata/entegrasyon testleri yazılsın.

## Karar

2026-11-08 tarihinde bu tasarımdan yalnızca cihaz içi salt okunur dosya doğrulama ve önizleme uygulandı; canlı sürüm ve doğrulama bilgisi [BACKUP-PREVIEW-RELEASE.md](BACKUP-PREVIEW-RELEASE.md) dosyasındadır. Sunucuya dosya aktarımı, mevcut kayıtlarla karşılaştırma veya geri yükleme yazımı eklenmedi. Üretim kayıtlarına dokunulmadı. Yazma özelliği başlamadan önce eklemeli birleştirme kapsamı, desteklenecek kayıt grupları ve geri alma davranışı bu belgedeki şartlara göre belirlenmelidir.

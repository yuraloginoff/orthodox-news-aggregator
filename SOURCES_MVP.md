# Источники для MVP

## Статусы и происхождение RSS

- `verified` — ссылка на сайт и RSS проверены.
- `needs_check` — источник или RSS ещё нужно проверить.
- `deferred` — источник отложен и не входит в текущий MVP.
- `no_rss` — RSS не найден.
- `official` — RSS предоставлен самим сайтом.
- `generated` — RSS создан внешним сервисом, например FetchRSS, или получен из Telegram.
- `filtered` — официальный RSS отфильтрован по категории.

## Россия / РПЦ (ROC, RU)

### Епархии с городами-миллионниками

| ID | Название | Епархия | Город | Население | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---:|---|---|---|---|---|---|
| R1 | Московская городская епархия | Московская | Москва | 12+ млн | https://moseparh.ru/ | https://moseparh.ru/cat/news/feed | RSS | high | needs_check | official |
| R2 | Коломенская епархия | Коломенская | Коломна | — | https://mosmit.ru/ | https://mosmit.ru/news/rss/ | RSS | medium | needs_check | official |
| R3 | Балашихинская епархия | Балашихинская | Балашиха | — | https://balep.ru | https://balep.ru/news/rss/ | RSS | medium | needs_check | official |
| R4 | Одинцовская епархия | Одинцовская | Одинцово | — | https://odinceparh.ru | https://odinceparh.ru/rss | RSS | medium | needs_check | official |
| R5 | Подольская епархия | Подольская | Подольск | — | https://podolskeparh.ru/ | https://podolskeparh.ru/feed/ | RSS | medium | needs_check | official |
| R6 | Сергиево-Посадская епархия | Сергиево-Посадская | Сергиев Посад | — | https://eparhsp.ru/ | https://eparhsp.ru/feed/ | RSS | medium | needs_check | official |
| R7 | Санкт-Петербургская епархия | Санкт-Петербургская | Санкт-Петербург | 5+ млн | https://mitropolia.spb.ru/news/av/ | — | HTML | high | needs_check | — |
| R8 | Выборгская епархия | Выборгская | Выборг | — | https://eparchiya-viborg.ru/ | https://eparchiya-viborg.ru/feed | RSS | medium | needs_check | official |
| R9 | Гатчинская епархия | Гатчинская | Гатчина | — | https://gatchinaeparhia.ru/ | https://gatchinaeparhia.ru/feed/ | RSS | medium | needs_check | official |
| R10 | Тихвинская епархия | Тихвинская | Тихвин | — | https://www.tikhvin-eparhia.ru/ | https://www.tikhvin-eparhia.ru/novosti?format=feed&type=rss | RSS | medium | needs_check | official |
| R11 | Нижегородская епархия | Нижегородская | Нижний Новгород | 1.2+ млн | https://nne.ru/ | https://nne.ru/news/feed/ | RSS | high | needs_check | official |
| R12 | Ростовская епархия | Ростовская | Ростов-на-Дону | 1.1+ млн | https://rostoveparhia.ru/ | https://rostoveparhia.ru/feed/ | RSS | high | needs_check | official |
| R13 | Екатеринбургская епархия | Екатеринбургская | Екатеринбург | 1.5+ млн | https://ekaterinburg-eparhia.ru/ | https://ekaterinburg-eparhia.ru/feed | RSS | high | needs_check | official |
| R14 | Казанская епархия | Казанская | Казань | 1.2+ млн | https://tatmitropolia.ru/newses/kaznews/ | https://tatmitropolia.ru/rss.asp | RSS | high | needs_check | filtered |
| R15 | Самарская епархия | Самарская | Самара | 1.1+ млн | https://samepar.ru/ | https://samepar.ru/novosti/ | RSS | high | needs_check | official |
| R16 | Челябинская епархия | Челябинская | Челябинск | 1.1+ млн | https://mitropolia74.ru/ | https://fetchrss.com/feed/1wwkViGyCE0R1wwkUY2Iq2eh.rss | RSS | low | needs_check | generated |
| R17 | Омская епархия | Омская | Омск | 1.1+ млн | https://omsk-eparhiya.ru/ | https://omsk-eparhiya.ru/feed | RSS | high | needs_check | official |
| R18 | Новосибирская епархия | Новосибирская | Новосибирск | 1.6+ млн | https://www.nskmi.ru/ | https://fetchrss.com/feed/1wwkViGyCE0R1wx2aM9yn37b.rss | RSS | high | needs_check | generated |
| R19 | Красноярская епархия | Красноярская | Красноярск | 1+ млн | https://kerpc.ru/ | https://kerpc.ru/feed | RSS | high | needs_check | official |
| R20 | Иркутская епархия | Иркутская | Иркутск | 1+ млн | http://www.iemp.ru | https://fetchrss.com/feed/1wwkViGyCE0R1wx2ps3fk071.rss | RSS | low | needs_check | generated |

### Дополнительные епархии

| ID | Название | Епархия | Город | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|---|---|
| R21 | Нижнетагильская епархия | Нижнетагильская | Нижний Тагил | https://tagileparhiya.ru/ | https://tagileparhiya.ru/feed/ | RSS | medium | needs_check | official |
| R22 | Пермская епархия | Пермская | Пермь | https://www.pravperm.ru/ | https://www.pravperm.ru/feed/ | RSS | medium | needs_check | official |
| R23 | Енисейская епархия | Енисейская | Енисейск | https://xn--80aanabpeej0a2anfc0etig.xn--p1ai/ | https://xn--80aanabpeej0a2anfc0etig.xn--p1ai/feed/ | RSS | medium | needs_check | official |
| R24 | Владикавказская епархия | Владикавказская | Владикавказ | https://blagos.ru/ | https://blagos.ru/rss.xml | RSS | medium | needs_check | official |

### Официальные источники и СМИ

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| R25 | Патриархия.ru | https://patriarchia.ru/news/ | https://api.patriarchia.ru/v1/rss/news | RSS | high | needs_check | official |
| R26 | Православие.ру | https://pravoslavie.ru/24/ | https://pravoslavie.ru/xml/full.xml | RSS | high | needs_check | filtered |

## Украина

### УПЦ (МП) (UOC, UA)

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| UA1 | Сумская епархия УПЦ | — | — | deferred | medium | deferred | — |
| UA2 | Хмельницкая епархия УПЦ | — | — | deferred | medium | deferred | — |
| UA3 | Союз православных журналистов (СПЖ) | https://spzh.eu/ru/news | https://spzh.eu/rss | RSS | high | needs_check | official |

### ПЦУ (OCU, UA)

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| UA4 | ПЦУ (официальные новости через СМИ) | — | — | deferred | medium | deferred | — |
| UA5 | ПЦУ новости (RBC.ua) | — | — | deferred | medium | deferred | — |

## Молдавия

### Moldova_ROC (MD)

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| MD1 | Митрополия Молдовы | https://mitropolia.md/ | https://mitropolia.md/ru/feed/ | RSS | high | needs_check | official |

### Moldova_ROM (MD)

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| MD2 | Митрополия Бессарабии | — | — | deferred | medium | deferred | — |

## Армения (Armenia, AM)

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| AM1 | Католикосат всех армян (Эчмиадзин) | https://www.armenianchurch.org/ | — | HTML | medium | needs_check | — |
| AM2 | Армянская церковь (новости) | https://www.etchmiadzin.com/ | — | HTML | medium | needs_check | — |

## Греция (GR)

### Greece_HOC

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| GR1 | Элладская церковь (официальный сайт) | https://www.ecclesia.gr/ | — | HTML | medium | needs_check | — |

### Greece_CP

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| GR2 | Митрополия Крита | — | — | deferred | low | deferred | — |

### Athos

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| ATH1 | Афон (общие новости) | https://orthodoxhouse.com/ | — | HTML | medium | needs_check | — |
| ATH2 | Монастырь Ватопед | https://www.vatopedi.gr/ | — | HTML | low | needs_check | — |
| ATH3 | Монастырь Эсфигмен | https://www.esfigmen.gr/ | — | HTML | low | needs_check | — |

## Общие новостные порталы

| ID | Название | Сайт | RSS | Тип | Приоритет | Статус | Происхождение RSS |
|---|---|---|---|---|---|---|---|
| P1 | РИА Новости (тема РПЦ) | https://ria.ru/organization_Russkaja_pravoslavnaja_cerkov/ | — | HTML | medium | needs_check | — |
| P2 | Коммерсантъ (тема РПЦ) | https://www.kommersant.ru/theme/1011 | — | HTML | medium | needs_check | — |
| P3 | Lenta.ru (тема РПЦ) | https://lenta.ru/tags/organizations/rpts/ | — | HTML | medium | needs_check | — |
| P4 | Вести.ru (религия) | https://www.vesti.ru/obshchestvo/religiya | — | HTML | medium | needs_check | — |
| P5 | UNIAN (Православие) | https://religions.unian.net/orthodoxy | — | HTML | medium | needs_check | — |

## Примечания

- Статус `needs_check` означает, что URL указан, но фактическая доступность и содержимое RSS ещё не проверены автоматически.
- RSS с FetchRSS помечается как `generated`; это временный источник, пригодный для MVP, но требующий мониторинга.
- RSS с фильтром по категории помечается как `filtered`; фильтр нужно реализовать в парсере.
- `deferred` означает, что источник отложен и пока не входит в ближайшую версию MVP.

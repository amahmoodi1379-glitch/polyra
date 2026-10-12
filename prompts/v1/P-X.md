کار: برای هر فعل و زمان زیر یک جدول صرف بساز. زبان: ⟦language⟧.

فهرست (code فعل | زمان):
⟦items⟧

واحدهای دستوری (unit_code | عنوان | سطح):
⟦units⟧

قواعد:
- verb همان code فعل در فهرست بالا است و tense همان زمان، بدون هیچ تغییری.
- ۶ شکل کامل با همین کلیدها: ⟦keys⟧.
- شکل فعل را بدون ضمیر فاعلی بنویس (ai، نه j'ai؛ mache، نه ich mache)؛ اپ ضمیر را خودش نشان می‌دهد و قبل از مصوت یا h خاموش خودش j' می‌گذارد.
- برای فعل‌های بازتابی ضمیر بازتابی را داخل شکل بیاور (me lave، wasche mich). برای فعل جداشدنی آلمانی شکل کامل را با فاصله بنویس (stehe auf).
- در زمان‌های مرکب، فعل کمکی را داخل شکل بیاور (ai mangé، habe gemacht، bin gegangen).
- فرانسوی با فعل کمکی être: شکل مذکر را بنویس (suis parti، sommes partis) و شکل مؤنث را در accepted_variants همان ضمیر (suis partie، sommes parties).
- subjonctif فرانسوی را بدون que بنویس (sois، نه que je sois).
- اگر شکل دومی هم رایج و درست است (مثلاً paye و paie، یا würde kommen کنار käme)، در accepted_variants همان ضمیر بنویس.
- unit_code: کد واحدی از فهرست بالا که همین زمان را برای همین نوع فعل درس می‌دهد (مثلاً برای فعل -er در passé composé واحد passé composé با avoir). اگر هیچ واحدی مناسب نیست، unit_code را null بگذار و دلیلش را در issues بنویس.
- review_card: true اگر فعل در این زمان بی‌قاعده است، و برای یک فعل نمونه از هر گروه منظم؛ برای بقیه فعل‌های منظم false.

خروجی: JSON با کلیدهای tables و issues، دقیقاً با ساختار این نمونه:

⟦example⟧

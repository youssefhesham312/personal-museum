/**
 * Tiny dependency-free UI localisation.
 *
 * The museum content itself is user-authored and is never translated. Only the
 * interface chrome, help text and error copy live here.
 *
 * Changing language persists the choice and reloads the page. That keeps every
 * surface (creator menu, HUD, loading screen, share messages) in one language
 * without a second rendering framework.
 */

const STORAGE_KEY = 'museum-language';
const SUPPORTED = ['en', 'ar'];

const EN = {
  'app.title': 'Personal Museum',
  'app.subtitle': 'A gallery you can send to someone',
  'app.documentTitle': 'Personal Museum',
  'app.metaDescription': 'A personal 3D virtual photo gallery',

  'language.switchToArabic': 'Switch to Arabic',
  'language.switchToEnglish': 'Switch to English',
  'language.arabic': 'العربية',
  'language.english': 'English',

  'creator.museumTitle': 'Museum title',
  'creator.recipient': "Recipient's name",
  'creator.dedication': 'Dedication',
  'creator.optional': 'optional',
  'creator.finalMessage': 'Closing message',
  'creator.addPhotos': 'Add Photos',
  'creator.noPhotos': 'No photos yet',
  'creator.photoCount': '{count} of {max} photos added',
  'creator.addingPhotos': 'Adding photos…',
  'creator.addingCount': 'Adding {count} photo…',
  'creator.addingCountPlural': 'Adding {count} photos…',
  'creator.photographs': 'Photographs',
  'creator.reorderHint': 'Drag the handle or use the arrows to reorder',
  'creator.caption': 'Caption',
  'creator.dragPhoto': 'Drag photograph {position} to reorder',
  'creator.moveEarlier': 'Move photograph {position} earlier',
  'creator.moveLater': 'Move photograph {position} later',
  'creator.removePhoto': 'Remove photograph {position}',
  'creator.moveEarlierShort': 'Move earlier',
  'creator.moveLaterShort': 'Move later',
  'creator.removePhotoShort': 'Remove photo',
  'creator.draftSaved': 'Draft saved in this browser. Captions and photo order are kept automatically.',
  'creator.previewTour': 'Preview the Tour',
  'creator.createShareLink': 'Create Share Link',
  'creator.resetPhotos': 'Reset Photos',
  'creator.shareNote': 'Share links are view-only and close automatically seven days after creation.',
  'creator.playMusic': '▶ Play Music',
  'creator.pauseMusic': '❚❚ Pause Music',
  'creator.musicOn': '♪ Music: On',
  'creator.musicOff': '♪ Music: Off',
  'creator.photoRemoved': 'Photo removed.',
  'creator.removeFailed': 'The photo could not be removed. Try again.',
  'creator.uploadFailed': 'The photos could not be added. Check browser storage and try again.',
  'creator.tooManyPhotos': 'A museum can hold at most {max} photos. Remove some first.',
  'creator.shareNotConfigured': '{message} Local preview still works.',
  'creator.creatingShare': 'Creating your share link…',
  'creator.tooManyToShare': 'A museum can hold at most {max} photographs. Remove some to share.',
  'creator.addOneMore': 'Add {count} more photograph to create a share link.',
  'creator.addMore': 'Add {count} more photographs to create a share link.',
  'creator.addDetails': 'Add a title, the recipient’s name and a closing message.',
  'creator.readyToShare': 'Ready to create a view-only link.',
  'creator.shareStale': 'Details or photographs changed. Create a new link to include the changes.',
  'creator.shareCancelled': 'Share link creation cancelled.',
  'creator.museumReady': 'Your museum is ready. Copy the link and send it.',
  'creator.shareNeedsPhotos': 'A shareable museum needs {min}–{max} photographs.',
  'creator.cleanupPending': ' The unfinished upload will be removed automatically.',

  'share.title': 'Your museum is ready',
  'share.urlLabel': 'Shareable museum link',
  'share.copy': 'Copy',
  'share.open': 'Open museum',
  'share.copied': 'Copied.',
  'share.copyManual': 'Press Ctrl/Cmd+C to copy.',
  'share.expiry': 'Open until {date}.',
  'share.closes': 'This museum closes seven days after creation.',
  'share.note': 'Anyone with this link can view the museum. It cannot edit or delete anything.',
  'share.progress.preparing': 'Preparing photographs…',
  'share.progress.photo': 'Preparing photograph {index} of {total}…',
  'share.progress.creating': 'Creating your museum…',
  'share.progress.uploading': 'Uploading photograph {index} of {total}…',
  'share.progress.finishing': 'Finishing uploads…',
  'share.progress.verifying': 'Checking every photograph…',
  'share.progress.ready': 'Ready.',
  'share.progress.cancelling': 'Cancelling…',
  'share.cancel': 'Cancel',

  'validation.title': 'Add a museum title.',
  'validation.recipient': "Add the recipient's name.",
  'validation.finalMessage': 'Add a closing message.',
  'validation.minPhotos': 'Add at least {count} photographs.',
  'validation.maxPhotos': 'A museum can hold at most {count} photographs.',

  'upload.addedOne': '1 photo added.',
  'upload.addedMany': '{count} photos added.',
  'upload.limitSkipped': ' Only {max} photos fit in a museum; {count} were not added.',
  'upload.noneAdded': 'Nothing was added — {names}{extra} could not be read.{tip}{limit}',
  'upload.partial': '{added} added, {failed} skipped ({names}{extra}).{tip}{limit}',
  'upload.heicTip': ' iPhone HEIC photos need to be exported as JPEG (or opened in Safari) first.',
  'upload.andMore': ' and {count} more',
  'upload.reasonFull': 'browser storage is full',
  'upload.reasonUnavailable': 'browser storage is unavailable',
  'upload.reasonHeic': 'HEIC photos are not supported by this browser',
  'upload.reasonUnreadable': 'the file could not be read as an image',
  'upload.reasonTooLarge': 'the file is larger than 30 MB',
  'upload.reasonNotImage': 'not an image file',

  'inspect.photograph': 'Photograph',
  'inspect.memory': 'A memory',
  'inspect.forRecipient': 'For {recipient}',
  'inspect.forYou': 'For you',
  'inspect.photoAlt': 'Photograph: {caption}',
  'inspect.close': 'Close',

  'hud.pauseMusic': 'Pause music',
  'hud.playMusic': 'Play music',
  'hud.muteMusic': 'Mute music',
  'hud.unmuteMusic': 'Unmute music',
  'hud.showControls': 'Show controls',
  'hud.leaveMuseum': 'Leave museum',
  'hud.view': 'View',
  'hud.read': 'Read',
  'hud.inspect': 'Inspect',
  'hud.viewPhoto': 'View photograph',
  'hud.readMessage': 'Read the message',
  'hud.desktopHint': 'WASD to walk · drag or click to look · click or E to inspect · Esc releases the mouse',
  'hud.touchHint': 'Left side to walk · drag to look · tap a frame or View to inspect',
  'hud.controlsKicker': 'How to explore',
  'hud.beginExploring': 'Begin exploring',
  'hud.closeControls': 'Close controls',
  'hud.walk': 'Walk',
  'hud.look': 'Look',
  'hud.close': 'Close',
  'hud.leave': 'Leave',
  'hud.walkDesktop': 'W A S D or the arrow keys',
  'hud.lookDesktop': 'move the mouse — click once to capture it, or drag',
  'hud.inspectDesktop': 'click a frame or press E',
  'hud.closeDesktop': 'Esc, ✕, or click outside the photo',
  'hud.leaveValue': 'Leave museum, top right',
  'hud.walkTouch': 'joystick on the left half',
  'hud.lookTouch': 'drag anywhere on the right half',
  'hud.inspectTouch': 'tap a frame or the View button',
  'hud.closeTouch': '✕ or tap outside the photo',
  'hud.mouseReleased': 'Mouse released. Click the museum to look around again.',
  'hud.fullscreenEnded': 'Fullscreen ended. The museum is still open - use Leave museum to exit.',

  'loading.preparing': 'Preparing Your Exhibition',
  'loading.opening': 'Opening the Museum',
  'loading.collecting': 'Collecting the photographs…',
  'loading.collectingYour': 'Collecting your photographs…',
  'loading.hanging': 'Hanging the last frames…',
  'loading.photo': 'Preparing photograph {index} of {total}…',
  'loading.finding': 'Finding your museum…',
  'loading.building': 'Building gallery rooms...',
  'loading.tryAgain': 'Try again',
  'loading.backToMenu': 'Back to menu',
  'loading.cancel': 'Cancel',
  'loading.errorTitle': 'The museum could not open',
  'loading.errorFallback': 'Something went wrong while preparing the museum.',
  'loading.errorSuffix': ' Check your connection and try again.',
  'loading.fatalSubtitle': 'Something is blocking the museum',
  'loading.fatalStorage': 'This browser blocked local storage, so photos cannot be kept. Try a private window in another browser, or allow site data for this page.',

  'unavailable.expiredTitle': 'This museum has closed',
  'unavailable.expiredMessage': 'Museums stay open for seven days after they are created. This one has reached the end of its run.',
  'unavailable.notFoundTitle': 'This museum could not be found',
  'unavailable.notFoundMessage': 'The link may be mistyped, or the museum may have been removed. Ask the sender for a fresh link.',
  'unavailable.invalidTitle': 'This link doesn’t look right',
  'unavailable.invalidMessage': 'The address is missing a valid museum link. Check that you copied the whole link.',
  'unavailable.networkTitle': 'The museum could not be opened',
  'unavailable.networkMessage': 'The museum service could not be reached. Check your connection and try again.',
  'unavailable.genericTitle': 'The museum could not be opened',
  'unavailable.genericMessage': 'Something went wrong while opening this museum. Please try again.',
  'unavailable.tryAgain': 'Try again',
  'unavailable.createOwn': 'Create your own museum',
  'unavailable.leftTitle': 'You have left “{title}”',
  'unavailable.leftGeneric': 'You have left the museum',
  'unavailable.leftMessage': 'The museum is still open. You can step back inside whenever you like.',
  'unavailable.stepBack': 'Step back inside',
  'unavailable.kicker': 'Personal Museum',

  'errors.notFound': 'This museum could not be found. The link may be mistyped, or the museum has been removed.',
  'errors.expired': 'This museum has closed. Museums stay open for seven days after they are created.',
  'errors.incomplete': 'Some photographs did not finish uploading. Please try again.',
  'errors.forbidden': 'This creation session is no longer valid. Please start a new museum.',
  'errors.cancelled': 'Cancelled.',
  'errors.genericCreate': 'The museum could not be created. Please try again.',
  'errors.generic': 'Something went wrong. Please try again.',
  'errors.rateLimited': 'Too many museums were created from this connection. Please try again later.',
  'errors.unavailable': 'Museums are temporarily unavailable.',
  'errors.uploadFailed': 'This photograph could not be uploaded. Try a smaller JPEG.',
  'errors.sharingNotConfigured': 'Sharing is not configured on this deployment.',
  'errors.checkDetails': 'Please check the museum details.',

  'foyer.defaultTitle': 'Personal Museum',
  'foyer.forRecipient': 'for {recipient}',
  'foyer.onePhoto': 'one photograph',
  'foyer.photoCount': '{count} photographs',
  'finale.forRecipient': 'For {recipient}',
  'finale.forYou': 'For you',
  'finale.defaultMessage': 'Thank you for walking through these memories.',

  'sample.title': 'The Personal Museum',
  'sample.dedication': 'A small collection of moments, kept for you.\nWalk slowly — each room holds something worth remembering.',
  'sample.finalMessage': 'Thank you for walking through these memories.\n\nSome places exist only for two people. This one is yours.',
};

const AR = {
  'app.title': 'المتحف الشخصي',
  'app.subtitle': 'معرض يمكنك إرساله إلى شخص ما',
  'app.documentTitle': 'المتحف الشخصي',
  'app.metaDescription': 'معرض صور ثلاثي الأبعاد شخصي',

  'language.switchToArabic': 'التبديل إلى العربية',
  'language.switchToEnglish': 'التبديل إلى الإنجليزية',
  'language.arabic': 'العربية',
  'language.english': 'English',

  'creator.museumTitle': 'عنوان المتحف',
  'creator.recipient': 'اسم المستلم',
  'creator.dedication': 'الإهداء',
  'creator.optional': 'اختياري',
  'creator.finalMessage': 'الرسالة الختامية',
  'creator.addPhotos': 'إضافة صور',
  'creator.noPhotos': 'لا توجد صور بعد',
  'creator.photoCount': '{count} من {max} صورة مضافة',
  'creator.addingPhotos': 'جارٍ إضافة الصور…',
  'creator.addingCount': 'جارٍ إضافة صورة…',
  'creator.addingCountPlural': 'جارٍ إضافة {count} صور…',
  'creator.photographs': 'الصور',
  'creator.reorderHint': 'اسحب المقبض أو استخدم الأسهم لإعادة الترتيب',
  'creator.caption': 'التعليق',
  'creator.dragPhoto': 'اسحب الصورة {position} لإعادة الترتيب',
  'creator.moveEarlier': 'انقل الصورة {position} إلى الأمام',
  'creator.moveLater': 'انقل الصورة {position} إلى الخلف',
  'creator.removePhoto': 'إزالة الصورة {position}',
  'creator.moveEarlierShort': 'نقل للأمام',
  'creator.moveLaterShort': 'نقل للخلف',
  'creator.removePhotoShort': 'إزالة الصورة',
  'creator.draftSaved': 'تم حفظ المسودة في هذا المتصفح. تُحفظ التعليقات وترتيب الصور تلقائيًا.',
  'creator.previewTour': 'معاينة المتحف',
  'creator.createShareLink': 'إنشاء رابط مشاركة',
  'creator.resetPhotos': 'إعادة ضبط الصور',
  'creator.shareNote': 'روابط المشاركة للعرض فقط وتُغلق تلقائيًا بعد سبعة أيام من الإنشاء.',
  'creator.playMusic': '▶ تشغيل الموسيقى',
  'creator.pauseMusic': '❚❚ إيقاف الموسيقى',
  'creator.musicOn': '♪ الموسيقى: مفعّلة',
  'creator.musicOff': '♪ الموسيقى: متوقفة',
  'creator.photoRemoved': 'تمت إزالة الصورة.',
  'creator.removeFailed': 'تعذرت إزالة الصورة. حاول مرة أخرى.',
  'creator.uploadFailed': 'تعذرت إضافة الصور. تحقق من مساحة التخزين في المتصفح وحاول مرة أخرى.',
  'creator.tooManyPhotos': 'يمكن أن يحتوي المتحف على {max} صورة كحد أقصى. أزل بعضها أولًا.',
  'creator.shareNotConfigured': '{message} المعاينة المحلية ما زالت تعمل.',
  'creator.creatingShare': 'جارٍ إنشاء رابط المشاركة…',
  'creator.tooManyToShare': 'يمكن أن يحتوي المتحف على {max} صورة كحد أقصى. أزل بعضها للمشاركة.',
  'creator.addOneMore': 'أضف صورة أخرى لإنشاء رابط مشاركة.',
  'creator.addMore': 'أضف {count} صور أخرى لإنشاء رابط مشاركة.',
  'creator.addDetails': 'أضف عنوانًا واسم المستلم ورسالة ختامية.',
  'creator.readyToShare': 'جاهز لإنشاء رابط للعرض فقط.',
  'creator.shareStale': 'تغيّرت التفاصيل أو الصور. أنشئ رابطًا جديدًا لتضمين التغييرات.',
  'creator.shareCancelled': 'تم إلغاء إنشاء رابط المشاركة.',
  'creator.museumReady': 'متحفك جاهز. انسخ الرابط وأرسله.',
  'creator.shareNeedsPhotos': 'يحتاج المتحف القابل للمشاركة إلى {min}–{max} صور.',
  'creator.cleanupPending': ' ستُزال عملية الرفع غير المكتملة تلقائيًا.',

  'share.title': 'متحفك جاهز',
  'share.urlLabel': 'رابط المتحف القابل للمشاركة',
  'share.copy': 'نسخ',
  'share.open': 'فتح المتحف',
  'share.copied': 'تم النسخ.',
  'share.copyManual': 'اضغط Ctrl/Cmd+C للنسخ.',
  'share.expiry': 'مفتوح حتى {date}.',
  'share.closes': 'يُغلق هذا المتحف بعد سبعة أيام من إنشائه.',
  'share.note': 'يمكن لأي شخص لديه هذا الرابط عرض المتحف. لا يمكنه تعديل أو حذف أي شيء.',
  'share.progress.preparing': 'جارٍ تحضير الصور…',
  'share.progress.photo': 'جارٍ تحضير الصورة {index} من {total}…',
  'share.progress.creating': 'جارٍ إنشاء متحفك…',
  'share.progress.uploading': 'جارٍ رفع الصورة {index} من {total}…',
  'share.progress.finishing': 'جارٍ إنهاء الرفع…',
  'share.progress.verifying': 'جارٍ التحقق من كل صورة…',
  'share.progress.ready': 'جاهز.',
  'share.progress.cancelling': 'جارٍ الإلغاء…',
  'share.cancel': 'إلغاء',

  'validation.title': 'أضف عنوانًا للمتحف.',
  'validation.recipient': 'أضف اسم المستلم.',
  'validation.finalMessage': 'أضف رسالة ختامية.',
  'validation.minPhotos': 'أضف {count} صور على الأقل.',
  'validation.maxPhotos': 'يمكن أن يحتوي المتحف على {count} صورة كحد أقصى.',

  'upload.addedOne': 'تمت إضافة صورة واحدة.',
  'upload.addedMany': 'تمت إضافة {count} صور.',
  'upload.limitSkipped': ' يمكن إضافة {max} صور فقط إلى المتحف؛ لم تتم إضافة {count}.',
  'upload.noneAdded': 'لم تتم إضافة أي شيء — تعذرت قراءة {names}{extra}.{tip}{limit}',
  'upload.partial': 'تمت إضافة {added}، وتم تخطي {failed} ({names}{extra}).{tip}{limit}',
  'upload.heicTip': ' يجب تصدير صور iPhone بصيغة HEIC إلى JPEG (أو فتحها في Safari) أولًا.',
  'upload.andMore': ' و{count} أخرى',
  'upload.reasonFull': 'مساحة المتصفح ممتلئة',
  'upload.reasonUnavailable': 'تخزين المتصفح غير متاح',
  'upload.reasonHeic': 'هذا المتصفح لا يدعم صور HEIC',
  'upload.reasonUnreadable': 'تعذرت قراءة الملف كصورة',
  'upload.reasonTooLarge': 'حجم الملف أكبر من 30 ميغابايت',
  'upload.reasonNotImage': 'ليس ملف صورة',

  'inspect.photograph': 'صورة',
  'inspect.memory': 'ذكرى',
  'inspect.forRecipient': 'إلى {recipient}',
  'inspect.forYou': 'لك',
  'inspect.photoAlt': 'صورة: {caption}',
  'inspect.close': 'إغلاق',

  'hud.pauseMusic': 'إيقاف الموسيقى مؤقتًا',
  'hud.playMusic': 'تشغيل الموسيقى',
  'hud.muteMusic': 'كتم الموسيقى',
  'hud.unmuteMusic': 'إلغاء كتم الموسيقى',
  'hud.showControls': 'عرض التعليمات',
  'hud.leaveMuseum': 'مغادرة المتحف',
  'hud.view': 'عرض',
  'hud.read': 'قراءة',
  'hud.inspect': 'فحص',
  'hud.viewPhoto': 'اعرض الصورة',
  'hud.readMessage': 'اقرأ الرسالة',
  'hud.desktopHint': 'WASD للسير · اسحب أو اضغط للنظر · اضغط أو E للفحص · Esc يحرر الماوس',
  'hud.touchHint': 'الجانب الأيسر للسير · اسحب للنظر · اضغط على إطار أو زر عرض للفحص',
  'hud.controlsKicker': 'كيف تستكشف',
  'hud.beginExploring': 'ابدأ الاستكشاف',
  'hud.closeControls': 'إغلاق التعليمات',
  'hud.walk': 'المشي',
  'hud.look': 'النظر',
  'hud.close': 'الإغلاق',
  'hud.leave': 'المغادرة',
  'hud.walkDesktop': 'W A S D أو مفاتيح الأسهم',
  'hud.lookDesktop': 'حرّك الماوس — اضغط مرة لالتقاطه، أو اسحب',
  'hud.inspectDesktop': 'اضغط على إطار أو اضغط E',
  'hud.closeDesktop': 'Esc أو ✕ أو اضغط خارج الصورة',
  'hud.leaveValue': 'زر مغادرة المتحف أعلى الشاشة',
  'hud.walkTouch': 'العصا اليسرى في النصف الأيسر',
  'hud.lookTouch': 'اسحب في أي مكان في النصف الأيمن',
  'hud.inspectTouch': 'اضغط على إطار أو زر عرض',
  'hud.closeTouch': '✕ أو اضغط خارج الصورة',
  'hud.mouseReleased': 'تم تحرير الماوس. اضغط على المتحف للنظر مجددًا.',
  'hud.fullscreenEnded': 'انتهى وضع ملء الشاشة. المتحف ما زال مفتوحًا - استخدم مغادرة المتحف للخروج.',

  'loading.preparing': 'جارٍ تحضير معرضك',
  'loading.opening': 'جارٍ فتح المتحف',
  'loading.collecting': 'جارٍ جمع الصور…',
  'loading.collectingYour': 'جارٍ جمع صورك…',
  'loading.hanging': 'جارٍ تعليق آخر الإطارات…',
  'loading.photo': 'جارٍ تحضير الصورة {index} من {total}…',
  'loading.finding': 'جارٍ العثور على متحفك…',
  'loading.building': 'جارٍ بناء قاعات المعرض...',
  'loading.tryAgain': 'حاول مرة أخرى',
  'loading.backToMenu': 'العودة إلى القائمة',
  'loading.cancel': 'إلغاء',
  'loading.errorTitle': 'تعذر فتح المتحف',
  'loading.errorFallback': 'حدث خطأ أثناء تحضير المتحف.',
  'loading.errorSuffix': ' تحقق من اتصالك وحاول مرة أخرى.',
  'loading.fatalSubtitle': 'هناك شيء يمنع فتح المتحف',
  'loading.fatalStorage': 'حظر هذا المتصفح التخزين المحلي، لذا لا يمكن الاحتفاظ بالصور. جرّب نافذة خاصة في متصفح آخر، أو اسمح ببيانات الموقع لهذه الصفحة.',

  'unavailable.expiredTitle': 'أُغلق هذا المتحف',
  'unavailable.expiredMessage': 'يبقى المتحف مفتوحًا سبعة أيام بعد إنشائه. وصل هذا المتحف إلى نهاية مدته.',
  'unavailable.notFoundTitle': 'تعذر العثور على هذا المتحف',
  'unavailable.notFoundMessage': 'قد يكون الرابط مكتوبًا بشكل خاطئ، أو ربما أُزيل المتحف. اطلب من المرسل رابطًا جديدًا.',
  'unavailable.invalidTitle': 'هذا الرابط لا يبدو صحيحًا',
  'unavailable.invalidMessage': 'العنوان لا يحتوي على رابط متحف صالح. تأكد من نسخ الرابط كاملًا.',
  'unavailable.networkTitle': 'تعذر فتح المتحف',
  'unavailable.networkMessage': 'تعذر الوصول إلى خدمة المتحف. تحقق من اتصالك وحاول مرة أخرى.',
  'unavailable.genericTitle': 'تعذر فتح المتحف',
  'unavailable.genericMessage': 'حدث خطأ أثناء فتح هذا المتحف. حاول مرة أخرى.',
  'unavailable.tryAgain': 'حاول مرة أخرى',
  'unavailable.createOwn': 'أنشئ متحفك الخاص',
  'unavailable.leftTitle': 'لقد غادرت «{title}»',
  'unavailable.leftGeneric': 'لقد غادرت المتحف',
  'unavailable.leftMessage': 'المتحف ما زال مفتوحًا. يمكنك العودة إليه متى شئت.',
  'unavailable.stepBack': 'العودة إلى الداخل',
  'unavailable.kicker': 'المتحف الشخصي',

  'errors.notFound': 'تعذر العثور على هذا المتحف. قد يكون الرابط مكتوبًا بشكل خاطئ، أو ربما أُزيل المتحف.',
  'errors.expired': 'أُغلق هذا المتحف. يبقى المتحف مفتوحًا سبعة أيام بعد إنشائه.',
  'errors.incomplete': 'لم تكتمل بعض الصور. حاول مرة أخرى.',
  'errors.forbidden': 'لم تعد جلسة الإنشاء صالحة. ابدأ متحفًا جديدًا.',
  'errors.cancelled': 'تم الإلغاء.',
  'errors.genericCreate': 'تعذر إنشاء المتحف. حاول مرة أخرى.',
  'errors.generic': 'حدث خطأ ما. حاول مرة أخرى.',
  'errors.rateLimited': 'تم إنشاء متاحف كثيرة من هذا الاتصال. حاول مرة أخرى لاحقًا.',
  'errors.unavailable': 'المتاحف غير متاحة مؤقتًا.',
  'errors.uploadFailed': 'تعذر رفع هذه الصورة. جرّب ملف JPEG أصغر.',
  'errors.sharingNotConfigured': 'المشاركة غير مهيأة في هذا النشر.',
  'errors.checkDetails': 'يرجى التحقق من تفاصيل المتحف.',

  'foyer.defaultTitle': 'المتحف الشخصي',
  'foyer.forRecipient': 'إلى {recipient}',
  'foyer.onePhoto': 'صورة واحدة',
  'foyer.photoCount': '{count} صور',
  'finale.forRecipient': 'إلى {recipient}',
  'finale.forYou': 'لك',
  'finale.defaultMessage': 'شكرًا لأنك مشيت عبر هذه الذكريات.',

  'sample.title': 'المتحف الشخصي',
  'sample.dedication': 'مجموعة صغيرة من اللحظات، محفوظة لك.\nامشِ ببطء — كل غرفة تحمل شيئًا يستحق التذكر.',
  'sample.finalMessage': 'شكرًا لأنك مشيت عبر هذه الذكريات.\n\nبعض الأماكن لا توجد إلا لشخصين. هذا المكان لك.',
};

const DICTIONARIES = { en: EN, ar: AR };

let current = 'en';

function readStoredLanguage() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function detectLanguage() {
  const stored = readStoredLanguage();
  if (stored) return stored;
  const nav = String(window.navigator?.language || '').toLowerCase();
  return nav.startsWith('ar') ? 'ar' : 'en';
}

function applyDocumentLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
}

/** Call once, before rendering any UI. */
export function initLanguage() {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    current = detectLanguage();
    applyDocumentLanguage();
  }
  return current;
}

export function getLanguage() {
  return current;
}

export function isRTL() {
  return current === 'ar';
}

export function locale() {
  return current === 'ar' ? 'ar-EG' : undefined;
}

export function setLanguage(language, { reload = false } = {}) {
  if (!SUPPORTED.includes(language)) return current;
  current = language;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* storage is optional */
    }
  }
  applyDocumentLanguage();
  if (reload && typeof window !== 'undefined') window.location.reload();
  return current;
}

export function toggleLanguage({ reload = false } = {}) {
  return setLanguage(current === 'ar' ? 'en' : 'ar', { reload });
}

/**
 * Translate a key. Interpolates `{name}` placeholders. Falls back to English,
 * then to the key itself, so a missing translation is visible instead of blank.
 */
export function t(key, params = {}) {
  const value = DICTIONARIES[current]?.[key] ?? EN[key] ?? key;
  if (typeof value === 'function') return value(params);
  return String(value).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Localise static elements marked with data-i18n / data-i18n-aria-label. */
export function applyStaticTranslations(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
  });
  if (typeof document !== 'undefined') {
    document.title = t('app.documentTitle');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('app.metaDescription'));
  }
}

/** Tests only. */
export function _resetLanguage() {
  current = 'en';
}

export function _dictionaryKeys() {
  return { en: Object.keys(EN), ar: Object.keys(AR) };
}

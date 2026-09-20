import type { StoreProduct, StoreCategory, StoreBanner } from '../types/store';

export const DEFAULT_STORE_CATEGORIES: StoreCategory[] = [
  {
    id: 'dossiers',
    nameAr: 'الدوسيات والملازم الوزارية',
    nameEn: 'Ministerial Dossiers & Booklets',
    description: 'شروحات شاملة، أسئلة إثرائية وتدريبات وزارية مكثفة لطلبة الثانوية العامة توجيهي فلسطين.',
    icon: 'BookOpen',
    color: '#2563eb',
    displayOrder: 1,
    isActive: true,
    itemCount: 4
  },
  {
    id: 'exam_packs',
    nameAr: 'باقات ونماذج الامتحانات المقترحة',
    nameEn: 'Exam Question Packs',
    description: 'نماذج امتحانات تجريبية ووزارية نهائية مع مفاتيح الإجابة والشروحات النموذجية.',
    icon: 'Layers',
    color: '#7c3aed',
    displayOrder: 2,
    isActive: true,
    itemCount: 3
  },
  {
    id: 'summaries',
    nameAr: 'ملخصات وخرائط المفاهيم',
    nameEn: 'Concept Summaries & Cheatsheets',
    description: 'ملخصات سريعة وقوانين فيزيائية ورياضية وخرائط ذهنية للمراجعة النهائية ليلة الامتحان.',
    icon: 'Sparkles',
    color: '#059669',
    displayOrder: 3,
    isActive: true,
    itemCount: 2
  },
  {
    id: 'points_cards',
    nameAr: 'بطاقات شحن الرصيد والنقاط',
    nameEn: 'Points & Balance Recharge Cards',
    description: 'شحن رصيد النقاط لفتح الأدوات الذكية وميزات الامتحانات ومسابقات المتفوقين.',
    icon: 'Coins',
    color: '#d97706',
    displayOrder: 4,
    isActive: true,
    itemCount: 2
  }
];

export const DEFAULT_STORE_BANNERS: StoreBanner[] = [
  {
    id: 'banner_tawjihi_launch',
    titleAr: 'عروض منصة Arixon لتوجيهي فلسطين 2009',
    titleEn: 'Tawjihi 2009 Special Educational Deals',
    subtitleAr: 'احصل على أقوى الدوسيات وباقات الامتحانات النموذجية بخصومات حصرية تصل حتى 35%',
    badgeText: '🔥 خصومات الموسم',
    imageUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1200&auto=format&fit=crop&q=80',
    targetCategory: 'dossiers',
    buttonTextAr: 'تصفح العروض',
    displayOrder: 1,
    isActive: true
  },
  {
    id: 'banner_arabic_grammar',
    titleAr: 'دوسية القواعد الشاملة - الممنوع من الصرف وتوابعه',
    titleEn: 'Arabic Grammar Dossier',
    subtitleAr: 'شرح مبسط وتدريبات وزارية دقيقة مع شروحات وتلميحات لكل قاعدة إعرابية.',
    badgeText: '⭐ الأكثر طلباً',
    imageUrl: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=1200&auto=format&fit=crop&q=80',
    targetProduct: 'prod_arabic_dossier',
    buttonTextAr: 'عرض الدوسية',
    displayOrder: 2,
    isActive: true
  }
];

export const DEFAULT_STORE_PRODUCTS: StoreProduct[] = [
  {
    id: 'prod_arabic_dossier',
    nameAr: 'دوسية التميز في اللغة العربية (القواعد والمطالعة)',
    nameEn: 'Excellence in Arabic Language Dossier',
    shortDescriptionAr: 'شاملة لقواعد النحو والصرف كاملة مع درس الممنوع من الصرف وتدريبات توجيهي فلسطين.',
    descriptionAr: 'الدوسية المعتمدة لطلبة الثانوية العامة (الفرعين العلمي والأدبي) - تتضمن شروحات نموذجية لجميع قواعد الصرف بما فيها الممنوع من الصرف لعلة ولعلتين، وأحكام الجر والصرف، بالإضافة إلى نماذج امتحانات وزارية سابقة مع مفاتيح الحل.',
    price: 35,
    oldPrice: 50,
    discountPercentage: 30,
    category: 'الدوسيات والملازم الوزارية',
    categoryId: 'dossiers',
    type: 'digital',
    stock: 999,
    images: [
      'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&auto=format&fit=crop&q=80'
    ],
    coverImage: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&auto=format&fit=crop&q=80',
    tags: ['لغة عربية', 'توجيهي', 'قواعد', 'الممنوع من الصرف'],
    isFeatured: true,
    isBestSeller: true,
    isPublished: true,
    shippingRequired: false,
    salesCount: 142,
    rating: 4.9,
    ratingCount: 38,
    badge: '🔥 الأكثر طلباً',
    digitalContent: {
      fileFormat: 'PDF',
      fileSize: '14.2 MB',
      pageCount: 120,
      accessInstructionsAr: 'يتم فتح الملف بصيغة PDF فور إتمام الشراء، ومتاح دائماً في مكتبتك الرقمية.'
    },
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z'
  },
  {
    id: 'prod_physics_pack',
    nameAr: 'حقيبة بنك الامتحانات الوزارية - الفيزياء المتقدمة',
    nameEn: 'Advanced Physics Ministerial Question Bank',
    shortDescriptionAr: 'أكثر من 500 سؤال اختيار من متعدد وتطبيقات على الميكانيكا والكهرباء وفق مواصفات 2009.',
    descriptionAr: 'حقيبة متكاملة تشمل تدريبات وأسئلة مستويات عليا على القوانين الفيزيائية والحسابية مع خطوات الحل التفصيلية والتلميحات المستقلة لضمان التفوق.',
    price: 45,
    oldPrice: 65,
    discountPercentage: 31,
    category: 'باقات ونماذج الامتحانات المقترحة',
    categoryId: 'exam_packs',
    type: 'digital',
    stock: 999,
    images: [
      'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=800&auto=format&fit=crop&q=80'
    ],
    coverImage: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=800&auto=format&fit=crop&q=80',
    tags: ['فيزياء', 'علمي', 'مسائل', 'وزاري'],
    isFeatured: true,
    isBestSeller: false,
    isPublished: true,
    shippingRequired: false,
    salesCount: 89,
    rating: 4.8,
    ratingCount: 22,
    badge: '⚡ باقة مميزة',
    digitalContent: {
      fileFormat: 'PDF',
      fileSize: '22.8 MB',
      pageCount: 180,
      accessInstructionsAr: 'تحميل مباشر للملف الرقمي وتفعيل بنك الأسئلة التفاعلي في حساب الطالب.'
    },
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-02-10T10:00:00Z'
  },
  {
    id: 'prod_math_cheatsheet',
    nameAr: 'خرائط المفاهيم وقوانين الرياضيات للثانوية العامة',
    nameEn: 'Mathematics Ultimate Formula Cheatsheet',
    shortDescriptionAr: 'جميع قوانين التفاضل والتكامل والمتجهات والمصفوفات ملخصة في 8 صفحات ملونة مركزة.',
    descriptionAr: 'ملخص شامل مطبوع وملون بدقة عالية يجمع كافة القوانين والمتطابقات المثلثية اللازمة لامتحان شهادة الدراسة الثانوية العامة.',
    price: 20,
    oldPrice: 30,
    discountPercentage: 33,
    category: 'ملخصات وخرائط المفاهيم',
    categoryId: 'summaries',
    type: 'digital',
    stock: 999,
    images: [
      'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=800&auto=format&fit=crop&q=80'
    ],
    coverImage: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=800&auto=format&fit=crop&q=80',
    tags: ['رياضيات', 'قوانين', 'ملخص', 'مراجعة مركزة'],
    isFeatured: false,
    isBestSeller: true,
    isPublished: true,
    shippingRequired: false,
    salesCount: 210,
    rating: 5.0,
    ratingCount: 54,
    badge: '⭐ مراجعة مركزة',
    digitalContent: {
      fileFormat: 'PDF',
      fileSize: '8.4 MB',
      pageCount: 8,
      accessInstructionsAr: 'ملف عالي الدقة جاهز للطباعة والمراجعة السريعة.'
    },
    createdAt: '2026-01-25T10:00:00Z',
    updatedAt: '2026-02-15T10:00:00Z'
  }
];

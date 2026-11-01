import type { Locale } from "@/server/campaigns/schema";

export interface Messages {
  language: string;
  fullName: string; mobile: string; email: string; optional: string;
  submit: string; submitting: string;
  consent: string; purpose: string; wall: string;
  selectPlaceholder: string;
  thanksTitle: string; thanksPending: string; viewCertificate: string;
  errRequired: string; errName: string; errMobile: string; errEmail: string; errConsent: string;
  errDuplicate: string; errCaptcha: string; errRate: string; errClosed: string; errOtp: string; errGeneric: string;
  errNumber: string; errDate: string; errOption: string; errLength: string;
  sendOtp: string; otpCode: string; verifyOtp: string; otpSent: string; otpVerified: string;
  closed: string;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: {
    language: "Language", fullName: "Full name", mobile: "Mobile number", email: "Email", optional: "optional",
    submit: "Get my certificate", submitting: "Please wait…",
    consent: "I agree that my details may be used to create my certificate and to contact me about this campaign.",
    purpose: "We collect your name and contact details only to issue your certificate and verify it.",
    wall: "Show my name on the public contributors wall",
    selectPlaceholder: "Select…",
    thanksTitle: "Thank you!", thanksPending: "Your entry has been received and will be reviewed. You will get your certificate after approval.", viewCertificate: "View my certificate",
    errRequired: "This field is required", errName: "Please enter your full name", errMobile: "Enter a valid mobile number", errEmail: "Enter a valid email address", errConsent: "Please accept the consent to continue",
    errDuplicate: "This mobile number has already been used for this campaign.", errCaptcha: "Could not verify you are human. Please retry.", errRate: "Too many attempts. Please try again in a few minutes.", errClosed: "This campaign is not accepting entries.", errOtp: "Verify your mobile number first.", errGeneric: "Something went wrong. Please try again.",
    errNumber: "Enter a valid number", errDate: "Enter a valid date", errOption: "Choose one of the options", errLength: "Invalid length or format",
    sendOtp: "Send code", otpCode: "Verification code", verifyOtp: "Verify", otpSent: "Code sent to your mobile.", otpVerified: "Mobile verified",
    closed: "This campaign is not accepting entries right now.",
  },
  hi: {
    language: "भाषा", fullName: "पूरा नाम", mobile: "मोबाइल नंबर", email: "ईमेल", optional: "वैकल्पिक",
    submit: "मेरा प्रमाणपत्र पाएँ", submitting: "कृपया प्रतीक्षा करें…",
    consent: "मैं सहमत हूँ कि मेरा प्रमाणपत्र बनाने और इस अभियान के बारे में मुझसे संपर्क करने के लिए मेरी जानकारी का उपयोग किया जा सकता है।",
    purpose: "हम आपका नाम और संपर्क विवरण केवल प्रमाणपत्र जारी करने और उसे सत्यापित करने के लिए लेते हैं।",
    wall: "मेरा नाम सार्वजनिक योगदानकर्ता सूची में दिखाएँ",
    selectPlaceholder: "चुनें…",
    thanksTitle: "धन्यवाद!", thanksPending: "आपकी प्रविष्टि प्राप्त हो गई है और उसकी समीक्षा की जाएगी। स्वीकृति के बाद आपको प्रमाणपत्र मिलेगा।", viewCertificate: "मेरा प्रमाणपत्र देखें",
    errRequired: "यह जानकारी आवश्यक है", errName: "कृपया अपना पूरा नाम लिखें", errMobile: "सही मोबाइल नंबर दर्ज करें", errEmail: "सही ईमेल पता दर्ज करें", errConsent: "आगे बढ़ने के लिए सहमति दें",
    errDuplicate: "इस अभियान के लिए यह मोबाइल नंबर पहले ही उपयोग हो चुका है।", errCaptcha: "सत्यापन विफल रहा। कृपया फिर प्रयास करें।", errRate: "बहुत अधिक प्रयास। कृपया कुछ मिनट बाद फिर प्रयास करें।", errClosed: "यह अभियान अभी प्रविष्टियाँ स्वीकार नहीं कर रहा है।", errOtp: "पहले अपना मोबाइल नंबर सत्यापित करें।", errGeneric: "कुछ गड़बड़ हो गई। कृपया फिर प्रयास करें।",
    errNumber: "सही संख्या दर्ज करें", errDate: "सही तारीख दर्ज करें", errOption: "विकल्पों में से चुनें", errLength: "अमान्य लंबाई या प्रारूप",
    sendOtp: "कोड भेजें", otpCode: "सत्यापन कोड", verifyOtp: "सत्यापित करें", otpSent: "कोड आपके मोबाइल पर भेजा गया।", otpVerified: "मोबाइल सत्यापित",
    closed: "यह अभियान अभी प्रविष्टियाँ स्वीकार नहीं कर रहा है।",
  },
  mr: {
    language: "भाषा", fullName: "पूर्ण नाव", mobile: "मोबाइल क्रमांक", email: "ईमेल", optional: "ऐच्छिक",
    submit: "माझे प्रमाणपत्र मिळवा", submitting: "कृपया थांबा…",
    consent: "माझे प्रमाणपत्र तयार करण्यासाठी आणि या मोहिमेबद्दल माझ्याशी संपर्क साधण्यासाठी माझी माहिती वापरण्यास माझी संमती आहे.",
    purpose: "आम्ही तुमचे नाव आणि संपर्क तपशील फक्त प्रमाणपत्र देण्यासाठी आणि त्याची पडताळणी करण्यासाठी घेतो.",
    wall: "माझे नाव सार्वजनिक योगदानकर्त्यांच्या यादीत दाखवा",
    selectPlaceholder: "निवडा…",
    thanksTitle: "धन्यवाद!", thanksPending: "तुमची नोंद मिळाली आहे आणि तिची तपासणी केली जाईल. मंजुरीनंतर तुम्हाला प्रमाणपत्र मिळेल.", viewCertificate: "माझे प्रमाणपत्र पहा",
    errRequired: "ही माहिती आवश्यक आहे", errName: "कृपया तुमचे पूर्ण नाव लिहा", errMobile: "योग्य मोबाइल क्रमांक टाका", errEmail: "योग्य ईमेल पत्ता टाका", errConsent: "पुढे जाण्यासाठी संमती द्या",
    errDuplicate: "या मोहिमेसाठी हा मोबाइल क्रमांक आधीच वापरला गेला आहे.", errCaptcha: "पडताळणी अयशस्वी. कृपया पुन्हा प्रयत्न करा.", errRate: "खूप प्रयत्न झाले. कृपया काही मिनिटांनी पुन्हा प्रयत्न करा.", errClosed: "ही मोहीम सध्या नोंदी स्वीकारत नाही.", errOtp: "आधी तुमचा मोबाइल क्रमांक पडताळा.", errGeneric: "काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.",
    errNumber: "योग्य संख्या टाका", errDate: "योग्य तारीख टाका", errOption: "पर्यायांपैकी निवडा", errLength: "अवैध लांबी किंवा स्वरूप",
    sendOtp: "कोड पाठवा", otpCode: "पडताळणी कोड", verifyOtp: "पडताळा", otpSent: "कोड तुमच्या मोबाइलवर पाठवला आहे.", otpVerified: "मोबाइल पडताळला",
    closed: "ही मोहीम सध्या नोंदी स्वीकारत नाही.",
  },
};

export const t = (locale: string): Messages => MESSAGES[(locale in MESSAGES ? locale : "en") as Locale];

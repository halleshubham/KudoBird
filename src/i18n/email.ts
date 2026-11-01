import type { Locale } from "@/server/campaigns/schema";

export interface EmailCopy {
  certSubject: string; certIntro: string; certButton: string; certAttached: string;
  rejectedSubject: string; rejectedIntro: string;
  footer: string; hello: string;
}

export const EMAIL_COPY: Record<Locale, EmailCopy> = {
  en: {
    certSubject: "Your certificate: {{campaign}}",
    certIntro: "Thank you, {{name}}! Your certificate {{certificate_no}} is attached. You can also view, verify and share it online.",
    certButton: "View and share your certificate", certAttached: "The certificate image is attached to this email.",
    rejectedSubject: "Update on your entry: {{campaign}}",
    rejectedIntro: "Thank you for your interest in {{campaign}}. Unfortunately we were not able to approve your entry this time.",
    footer: "Sent by {{org}}", hello: "Hello {{name}},",
  },
  hi: {
    certSubject: "आपका प्रमाणपत्र: {{campaign}}",
    certIntro: "धन्यवाद, {{name}}! आपका प्रमाणपत्र {{certificate_no}} संलग्न है। आप इसे ऑनलाइन देख, सत्यापित और साझा भी कर सकते हैं।",
    certButton: "प्रमाणपत्र देखें और साझा करें", certAttached: "प्रमाणपत्र की छवि इस ईमेल के साथ संलग्न है।",
    rejectedSubject: "आपकी प्रविष्टि के बारे में सूचना: {{campaign}}",
    rejectedIntro: "{{campaign}} में रुचि दिखाने के लिए धन्यवाद। खेद है कि इस बार हम आपकी प्रविष्टि स्वीकार नहीं कर सके।",
    footer: "प्रेषक: {{org}}", hello: "नमस्कार {{name}},",
  },
  mr: {
    certSubject: "तुमचे प्रमाणपत्र: {{campaign}}",
    certIntro: "धन्यवाद, {{name}}! तुमचे प्रमाणपत्र {{certificate_no}} सोबत जोडले आहे. तुम्ही ते ऑनलाइन पाहू, पडताळू आणि शेअरही करू शकता.",
    certButton: "प्रमाणपत्र पहा आणि शेअर करा", certAttached: "प्रमाणपत्राची प्रतिमा या ईमेलसोबत जोडली आहे.",
    rejectedSubject: "तुमच्या नोंदीबद्दल सूचना: {{campaign}}",
    rejectedIntro: "{{campaign}} मध्ये रस दाखवल्याबद्दल धन्यवाद. खेद आहे की यावेळी आम्ही तुमची नोंद मंजूर करू शकलो नाही.",
    footer: "प्रेषक: {{org}}", hello: "नमस्कार {{name}},",
  },
};
export const emailCopy = (locale: string) => EMAIL_COPY[(locale in EMAIL_COPY ? locale : "en") as Locale];

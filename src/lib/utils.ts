import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function whatsappLink(number: string, text?: string): string {
  let n = formatPhone(number);
  if (!n) return "";
  
  // If it starts with '0', prefix the Bangladesh country code '88'
  if (n.startsWith("0")) {
    n = "88" + n;
  } else if (n.length === 10 && n.startsWith("1")) {
    // If it's 10 digits starting with 1 (like 17xxxxxxxx), prefix with '880'
    n = "880" + n;
  }
  
  const base = `https://wa.me/${n}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

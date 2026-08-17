import { Link } from 'react-router-dom';
import { GraduationCap, Phone, Mail, MapPin, Facebook, MessageCircle } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';

export function Footer() {
  const { settings } = useSettingsStore();
  const year = new Date().getFullYear();

  return (
    <footer className="bg-navy-900 border-t border-navy-700/50 mt-20">
      <div className="max-w-6xl mx-auto px-4 py-14 grid grid-cols-1 md:grid-cols-4 gap-10">
        {/* Brand */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-violet-500 flex items-center justify-center glow-blue">
              <GraduationCap size={22} className="text-white" />
            </div>
            <span className="font-inter font-bold text-white text-lg">{settings.centerName}</span>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-6">
            মানসম্পন্ন শিক্ষা ও ব্যক্তিগতকৃত গাইডেন্সের মাধ্যমে শিক্ষার্থীদের উজ্জ্বল ভবিষ্যৎ গড়তে আমরা প্রতিশ্রুতিবদ্ধ।
          </p>
          {/* Social icons */}
          <div className="flex items-center gap-3">
            <a
              href="#"
              aria-label="Facebook"
              className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-sky-400 hover:border-sky-400/30 hover:bg-sky-400/10 transition-all"
            >
              <Facebook size={16} />
            </a>
            <a
              href={settings.centerPhone ? `https://wa.me/88${settings.centerPhone.replace(/-/g, '')}` : '#'}
              aria-label="WhatsApp"
              className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-emerald-400 hover:border-emerald-400/30 hover:bg-emerald-400/10 transition-all"
            >
              <MessageCircle size={16} />
            </a>
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="font-inter font-semibold text-white mb-4 text-sm tracking-wide uppercase">Quick Links</h4>
          <div className="space-y-2.5">
            {[['/', 'Home'], ['/courses', 'Courses'], ['/admission', 'Admission'], ['/notices', 'Notice Board'], ['/contact', 'Contact']].map(([to, label]) => (
              <Link
                key={to}
                to={to}
                className="block text-slate-400 hover:text-sky-400 text-sm transition-colors hover:translate-x-1 transform duration-200"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div>
          <h4 className="font-inter font-semibold text-white mb-4 text-sm tracking-wide uppercase">Contact</h4>
          <div className="space-y-3 text-sm text-slate-400">
            {settings.centerPhone && (
              <a href={`tel:${settings.centerPhone}`} className="flex items-start gap-2.5 hover:text-sky-400 transition-colors">
                <Phone size={14} className="shrink-0 mt-0.5" />
                <span>{settings.centerPhone}</span>
              </a>
            )}
            {settings.centerEmail && (
              <a href={`mailto:${settings.centerEmail}`} className="flex items-start gap-2.5 hover:text-sky-400 transition-colors">
                <Mail size={14} className="shrink-0 mt-0.5" />
                <span>{settings.centerEmail}</span>
              </a>
            )}
            {settings.centerAddress && (
              <p className="flex items-start gap-2.5">
                <MapPin size={14} className="shrink-0 mt-0.5" />
                <span>{settings.centerAddress}</span>
              </p>
            )}
            {!settings.centerPhone && !settings.centerEmail && !settings.centerAddress && (
              <p className="text-slate-500 text-xs italic">Configure contact info in Admin → Settings</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-navy-700/50 py-5 text-center">
        <p className="text-slate-500 text-xs">
          © {year} {settings.centerName}. All rights reserved.{' '}
          <span className="text-slate-600">·</span>{' '}
          Powered by{' '}
          <span className="text-sky-500 font-semibold tracking-wide">TECHELY</span>
        </p>
      </div>
    </footer>
  );
}

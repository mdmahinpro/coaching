import { AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-navy-900">
      <div className="card-glass p-10 w-full max-w-md mx-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto mb-5">
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>
        <h1 className="text-3xl font-bold text-white font-inter mb-2">404</h1>
        <p className="text-slate-400 mb-6">পেজটি পাওয়া যায়নি।</p>
        <Link to="/" className="btn-primary text-sm justify-center">
          হোমে ফিরে যান
        </Link>
      </div>
    </div>
  );
}

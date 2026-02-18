"use client";

import { useEffect } from "react";

export default function InstallersRedirect() {
  useEffect(() => {
    window.location.replace("/solar/directory/?type=installer");
  }, []);

  return (
    <div className="text-center py-12 text-gray-500">
      Redirecting to <a href="/solar/directory/?type=installer" className="text-blue-600 hover:underline">Business Directory</a>...
    </div>
  );
}

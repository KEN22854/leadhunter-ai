/** @type {import('next').NextConfig} */
const nextConfig = {
  // Отдельная папка сборки позволяет проверять next build, не останавливая dev-сервер (NEXT_DIST_DIR=.next-build)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pdfmake", "nodemailer", "imapflow", "mailparser"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;

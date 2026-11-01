/* KudoBird embeddable form. Usage:
 * <script src="https://YOUR-HOST/embed.js" data-org="my-org" data-campaign="my-campaign" async></script>
 * The site you put it on must be listed under "Embed on your website" for the campaign. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var org = s.getAttribute("data-org"), campaign = s.getAttribute("data-campaign"), lang = s.getAttribute("data-lang");
  if (!org || !campaign) { console.error("KudoBird embed: data-org and data-campaign are required"); return; }
  var origin = new URL(s.src).origin;
  var f = document.createElement("iframe");
  f.src = origin + "/embed/o/" + encodeURIComponent(org) + "/" + encodeURIComponent(campaign) + (lang ? "?lang=" + encodeURIComponent(lang) : "");
  f.title = "Certificate form";
  f.loading = "lazy";
  f.setAttribute("scrolling", "no");
  f.style.cssText = "width:100%;max-width:480px;border:0;height:760px;display:block";
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener("message", function (e) {
    // Only accept resize messages that really come from our own frame.
    if (e.origin !== origin || e.source !== f.contentWindow) return;
    var d = e.data;
    if (d && d.type === "kudobird:resize" && typeof d.height === "number" && d.height > 100 && d.height < 5000) f.style.height = Math.ceil(d.height) + "px";
  });
})();

// Same-origin is used by the combined FastAPI demo. For a separate driver
// website, set BACKEND_URL to the public HTTPS URL of the backend before deploy.
window.BACKEND_URL = window.BACKEND_URL || ""; // Replace with the backend HTTPS URL for separate hosting.
window.API_HOST = window.BACKEND_URL;
// Optional: link the driver site to the separately deployed public site.
window.PUBLIC_APP_URL = window.PUBLIC_APP_URL || "";

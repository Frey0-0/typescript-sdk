import { BatchInterceptor } from "@mswjs/interceptors";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { XMLHttpRequestInterceptor } from "@mswjs/interceptors/XMLHttpRequest";

const interceptor = new BatchInterceptor({
  name: "http-client-interceptor",
  interceptors: [
    new ClientRequestInterceptor(),
    new XMLHttpRequestInterceptor(),
  ],
});

interceptor.apply();

// This "request" listener will be called on both
// "ClientRequest" and "XMLHttpRequest" being dispatched.
interceptor.on("request", (req) => {
  console.log("Request started", req);
});

interceptor.on("response", (res) => {
  console.log("Response received", res);
});

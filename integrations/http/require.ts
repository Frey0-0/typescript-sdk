import { BatchInterceptor } from "@mswjs/interceptors";
import { ClientRequestInterceptor } from "@mswjs/interceptors/ClientRequest";
import { XMLHttpRequestInterceptor } from "@mswjs/interceptors/XMLHttpRequest";
import * as zlib from "zlib";
import { getExecutionContext } from "../../src/context";
import { MODE_RECORD, MODE_TEST, MODE_OFF } from "../../src/mode";
import { HTTP, V1_BETA2 } from "../../src/keploy";
import { getRequestHeader, getResponseHeader } from "../express/middleware";
import { MockIds } from "../../mock/mock";
import { putMocks } from "../../mock/utils";
import { DataBytes } from "../../proto/services/DataBytes";
import { getReasonPhrase } from "http-status-codes";
import { ProcessDep } from "../../src/util";

const interceptor = new BatchInterceptor({
  name: "http-client-interceptor",
  interceptors: [
    new ClientRequestInterceptor(),
    new XMLHttpRequestInterceptor(),
  ],
});

interceptor.apply();
let httpRequest: {
  url: string;
  method: string;
  headers: Headers;
  body: string;
};

function getHeadersInit(headers: { [k: string]: string[] }): {
  [k: string]: string;
} {
  const result: { [key: string]: string } = {};
  for (const key in headers) {
    result[key] = headers[key].join(", ");
  }
  return result;
}
// This "request" listener will be called on both
// "ClientRequest" and "XMLHttpRequest" being dispatched.
interceptor.on("request", async (req) => {
  if (
    getExecutionContext() == undefined ||
    getExecutionContext().context == undefined
  ) {
    console.error("keploy context is not present to mock dependencies");
    return;
  }
  // @ts-ignore
  req.headers.set("accept-encoding", "none");
  // @ts-ignore
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const { value } = await reader.read();
  const reqBody = decoder.decode(value);
  httpRequest = {
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: reqBody,
  };
});

interceptor.on("response", async (res) => {
  // @ts-ignore
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const decoder = new TextDecoder("utf-8");
  const encoding = res.headers.get("content-encoding");
  let body = "";
  switch (encoding) {
    case "gzip":
      // @ts-ignore
      body = zlib.gunzipSync(value).toString();
      break;
    case "deflate":
      // @ts-ignore
      body = zlib.inflateSync(value).toString();
      break;
    case "br":
      // @ts-ignore
      body = zlib.brotliDecompressSync(value).toString();
      break;
    default:
      body = decoder.decode(value);
      break;
  }
  const ctx = getExecutionContext().context;
  let rinit: {
    headers: { [key: string]: string };
    status: number;
    statusText: string;
  } = {
    headers: {},
    status: 200,
    statusText: "OK",
  };
  const meta = {
    name: "http-client-interceptor",
    url: httpRequest.url,
    type: "HTTP_CLIENT",
  };
  switch (ctx.mode) {
    case MODE_RECORD:
      rinit = {
        headers: JSON.parse(JSON.stringify(res.headers)),
        status: res.status,
        statusText: res.statusText,
      };
      const httpMock = {
        Version: V1_BETA2,
        Name: ctx.testId,
        Kind: HTTP,
        Spec: {
          Metadata: meta,
          Req: {
            URL: httpRequest.url,
            Body: httpRequest.body,
            Header: getRequestHeader(httpRequest.headers),
            Method: httpRequest.method,
          },
          Res: {
            StatusCode: rinit.status,
            Header: getResponseHeader(rinit.headers),
            Body: body,
          },
        },
      };
      if (ctx.fileExport === true) {
        MockIds[ctx.testId] !== true ? putMocks(httpMock) : "";
      } else {
        ctx.mocks.push(httpMock);
        const res: DataBytes[] = [];
        res.push({ Bin: Buffer.from(JSON.stringify(body)) });
        res.push({ Bin: Buffer.from(JSON.stringify(rinit)) });
        ctx.deps.push({
          Name: meta.name,
          Type: meta.type,
          Meta: meta,
          Data: res,
        });
      }
      break;
    case MODE_TEST:
      const outputs = new Array(2);
      if (
        ctx.mocks != undefined &&
        ctx.mocks.length > 0 &&
        ctx.mocks[0].Kind == HTTP
      ) {
        const header: { [key: string]: string[] } = {};
        for (const k in ctx.mocks[0].Spec?.Res?.Header) {
          header[k] = ctx.mocks[0].Spec?.Res?.Header[k]?.Value;
        }
        outputs[1] = {
          headers: getHeadersInit(header),
          status: ctx.mocks[0].Spec.Res.StatusCode,
          statusText: getReasonPhrase(ctx.mocks[0].Spec.Res.StatusCode),
        };

        outputs[0] = [ctx.mocks[0].Spec.Res.Body];
        if (ctx?.fileExport) {
          console.log(
            "🤡 Returned the mocked outputs for Http dependency call with meta: ",
            meta
          );
        }
      } else {
        ProcessDep(ctx, {}, outputs);
      }
      rinit.headers = outputs[1].headers;
      rinit.status = outputs[1].status;
      rinit.statusText = outputs[1].statusText;
      // to complete, remainig work
      break;
    case MODE_OFF:
      return;
    default:
      console.debug(
        `keploy mode '${ctx.mode}' is invalid. Modes: 'record' / 'test' / 'off'(default)`
      );
      return;
  }
});

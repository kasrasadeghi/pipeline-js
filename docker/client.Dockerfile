FROM alpine:3.14

RUN apk add --no-cache curl ca-certificates

CMD ["sh", "-c", "sleep 5 && curl --cacert /cert/cert.pem https://server:8100 && echo"]
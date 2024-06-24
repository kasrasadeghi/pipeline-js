FROM alpine:3.14

RUN apk add --no-cache curl

CMD ["sh", "-c", "sleep 5 && curl http://server:5000 && echo"]
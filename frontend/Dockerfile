FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY ./public /usr/share/nginx/html 

EXPOSE 80

HEALTHCHECK --interval=2m --timeout=3s \
    CMD curl -f http://localhost/index.html || exit 1
#include <iostream>
#include <string>
#include <cstring>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <poll.h>

const int PROXY_PORT = 8000;
const int DESTINATION_PORT = 8001;
const int BUFFER_SIZE = 16384;
const char* DESTINATION_IP = "127.0.0.1";

void init_openssl() {
    SSL_load_error_strings();
    OpenSSL_add_ssl_algorithms();
}

void cleanup_openssl() {
    EVP_cleanup();
}

SSL_CTX* create_ssl_context(bool is_server) {
    const SSL_METHOD* method = is_server ? TLS_server_method() : TLS_client_method();
    SSL_CTX* ctx = SSL_CTX_new(method);
    if (!ctx) {
        std::cerr << "Unable to create SSL context" << std::endl;
        ERR_print_errors_fp(stderr);
        exit(EXIT_FAILURE);
    }
    return ctx;
}

void configure_ssl_context(SSL_CTX* ctx, const char* cert_file, const char* key_file) {
    if (SSL_CTX_use_certificate_file(ctx, cert_file, SSL_FILETYPE_PEM) <= 0) {
        ERR_print_errors_fp(stderr);
        exit(EXIT_FAILURE);
    }
    if (SSL_CTX_use_PrivateKey_file(ctx, key_file, SSL_FILETYPE_PEM) <= 0) {
        ERR_print_errors_fp(stderr);
        exit(EXIT_FAILURE);
    }
}

int create_socket(int port, bool is_server) {
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        perror("Unable to create socket");
        exit(EXIT_FAILURE);
    }

    if (is_server) {
        int option = 1;
        setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &option, sizeof(option));
    }

    sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    
    if (is_server) {
        addr.sin_addr.s_addr = INADDR_ANY;
        if (bind(sock, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
            perror("Unable to bind");
            exit(EXIT_FAILURE);
        }
        if (listen(sock, 1) < 0) {
            perror("Unable to listen");
            exit(EXIT_FAILURE);
        }
    } else {
        addr.sin_addr.s_addr = inet_addr(DESTINATION_IP);
        if (connect(sock, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
            perror("Unable to connect");
            exit(EXIT_FAILURE);
        }
    }

    return sock;
}

void handle_client(int client_sock, SSL* client_ssl, SSL_CTX* dest_ctx) {
    int dest_sock = create_socket(DESTINATION_PORT, false);
    SSL* dest_ssl = SSL_new(dest_ctx);
    SSL_set_fd(dest_ssl, dest_sock);

    if (SSL_connect(dest_ssl) <= 0) {
        ERR_print_errors_fp(stderr);
        SSL_free(dest_ssl);
        close(dest_sock);
        return;
    }

    char buffer[BUFFER_SIZE];
    struct pollfd fds[2];
    fds[0].fd = client_sock;
    fds[0].events = POLLIN;
    fds[1].fd = dest_sock;
    fds[1].events = POLLIN;

    while (true) {
        int poll_result = poll(fds, 2, -1);
        if (poll_result < 0) {
            perror("Poll failed");
            break;
        }

        for (int i = 0; i < 2; ++i) {
            if (fds[i].revents & POLLIN) {
                SSL* read_ssl = (i == 0) ? client_ssl : dest_ssl;
                SSL* write_ssl = (i == 0) ? dest_ssl : client_ssl;

                int bytes_read = SSL_read(read_ssl, buffer, BUFFER_SIZE);
                if (bytes_read <= 0) {
                    if (SSL_get_error(read_ssl, bytes_read) == SSL_ERROR_ZERO_RETURN) {
                        std::cout << "Connection closed" << std::endl;
                    } else {
                        ERR_print_errors_fp(stderr);
                    }
                    goto cleanup;
                }

                int bytes_written = SSL_write(write_ssl, buffer, bytes_read);
                if (bytes_written <= 0) {
                    ERR_print_errors_fp(stderr);
                    goto cleanup;
                }
            }
        }
    }

cleanup:
    SSL_shutdown(dest_ssl);
    SSL_free(dest_ssl);
    close(dest_sock);
}

int main() {
    init_openssl();
    SSL_CTX* server_ctx = create_ssl_context(true);
    SSL_CTX* client_ctx = create_ssl_context(false);

    configure_ssl_context(server_ctx, "cert/cert.pem", "cert/key.pem");
    
    int server_sock = create_socket(PROXY_PORT, true);

    std::cout << "Proxy server running on port " << PROXY_PORT << std::endl;

    while (true) {
        sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        int client_sock = accept(server_sock, (struct sockaddr*)&client_addr, &client_len);
        
        if (client_sock < 0) {
            perror("Unable to accept");
            continue;
        }

        SSL* client_ssl = SSL_new(server_ctx);
        SSL_set_fd(client_ssl, client_sock);

        if (SSL_accept(client_ssl) <= 0) {
            ERR_print_errors_fp(stderr);
            SSL_free(client_ssl);
            close(client_sock);
            continue;
        }

        std::cout << "New connection from " << inet_ntoa(client_addr.sin_addr) << std::endl;

        handle_client(client_sock, client_ssl, client_ctx);

        SSL_shutdown(client_ssl);
        SSL_free(client_ssl);
        close(client_sock);
    }

    close(server_sock);
    SSL_CTX_free(server_ctx);
    SSL_CTX_free(client_ctx);
    cleanup_openssl();

    return 0;
}
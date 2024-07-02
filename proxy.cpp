#include <iostream>
#include <string>
#include <cstring>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <poll.h>
#include <chrono>
#include <iomanip>

const int PROXY_PORT = 8000;
const int DESTINATION_PORT = 8001;
const int BUFFER_SIZE = 16384;
const char* DESTINATION_IP = "127.0.0.1";
const int SOCKET_TIMEOUT = 1; // 1 second timeout
const int LISTEN_BACKLOG = 10;

void log_time() {
    auto now = std::chrono::system_clock::now();
    auto now_c = std::chrono::system_clock::to_time_t(now);
    auto now_ms = std::chrono::duration_cast<std::chrono::microseconds>(now.time_since_epoch()) % 1000000;
    std::cout << std::put_time(std::localtime(&now_c), "%Y-%m-%d %H:%M:%S") 
              << '.' << std::setfill('0') << std::setw(6) << now_ms.count() << " ";
}

void log(const std::string& message) {
    log_time();
    std::cout << message << std::endl;
}

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

int set_socket_timeout(int sockfd, int seconds) {
    struct timeval timeout;
    timeout.tv_sec = seconds;
    timeout.tv_usec = 0;

    if (setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) < 0) {
        log("setsockopt failed for SO_RCVTIMEO");
        return 1;
    }

    if (setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)) < 0) {
        log("setsockopt failed for SO_SNDTIMEO");
        return 1;
    }

    return 0;
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
        if (listen(sock, LISTEN_BACKLOG) < 0) {
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

    if (! is_server) {
        if (set_socket_timeout(sock, SOCKET_TIMEOUT) != 0) {
            close(sock);
            exit(EXIT_FAILURE);
        }
    }
    return sock;
}

void handle_client(int client_sock, SSL* client_ssl, SSL_CTX* dest_ctx) {
    log("Handling new client connection");
    int dest_sock = create_socket(DESTINATION_PORT, false);
    SSL* dest_ssl = SSL_new(dest_ctx);
    SSL_set_fd(dest_ssl, dest_sock);

    if (SSL_connect(dest_ssl) <= 0) {
        log("Failed to perform SSL handshake with destination server");
        ERR_print_errors_fp(stderr);
        SSL_free(dest_ssl);
        close(dest_sock);
        return;
    }
    log("Connected to destination server");

    char buffer[BUFFER_SIZE];
    struct pollfd fds[2];
    fds[0].fd = client_sock;
    fds[0].events = POLLIN;
    fds[1].fd = dest_sock;
    fds[1].events = POLLIN;

    while (true) {
        log("=== poll ===");
        int poll_result = poll(fds, 2, -1);
        if (poll_result < 0) {
            log("Poll failed");
            break;
        }
        log("- ready: " + std::to_string(poll_result) + ", " +
            "clientSocket: " + std::to_string(fds[0].revents & POLLIN) + ", " +
            "destinationSocket: " + std::to_string(fds[1].revents & POLLIN));

        for (int i = 0; i < 2; ++i) {
            if (fds[i].revents & POLLIN) {
                SSL* read_ssl = (i == 0) ? client_ssl : dest_ssl;
                SSL* write_ssl = (i == 0) ? dest_ssl : client_ssl;
                std::string direction = (i == 0) ? "--- client ----------------------------------------------" 
                                                 : "--- destination -----------------------------------------";
                log(direction);
                log("clearing errors");
                ERR_clear_error();
                log("reading bytes...");

                int bytes_read = SSL_read(read_ssl, buffer, BUFFER_SIZE);
                if (bytes_read <= 0) {
                    int ssl_error = SSL_get_error(read_ssl, bytes_read);
                    if (ssl_error == SSL_ERROR_ZERO_RETURN) {
                        log("Connection closed");
                    } else if (ssl_error == SSL_ERROR_WANT_READ || ssl_error == SSL_ERROR_WANT_WRITE) {
                        log("SSL operation would block, continuing...");
                        continue;
                    } else {
                        log("SSL_read failed");
                        ERR_print_errors_fp(stderr);
                    }
                    goto cleanup;
                }
                log(std::to_string(bytes_read) + " received");

                log("writing bytes...");
                int bytes_written = SSL_write(write_ssl, buffer, bytes_read);
                if (bytes_written <= 0) {
                    int ssl_error = SSL_get_error(write_ssl, bytes_written);
                    if (ssl_error == SSL_ERROR_WANT_WRITE || ssl_error == SSL_ERROR_WANT_READ) {
                        log("SSL operation would block, continuing...");
                        continue;
                    } else {
                        ERR_print_errors_fp(stderr);
                        log("SSL_write failed");
                        goto cleanup;
                    }
                }
                log(std::to_string(bytes_written) + " sent");
            }
        }
    }

cleanup:
    log("Closing connection");
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

    log("Proxy server running on port " + std::to_string(PROXY_PORT));

    while (true) {
        log("===--- waiting for connection --------------------------------===");
        log("accept");
        sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        int client_sock = accept(server_sock, (struct sockaddr*)&client_addr, &client_len);
        if (client_sock == -1) {
            int errorCode = errno;
            std::cerr << "Failed to accept client connection. Error code: " << errorCode 
                    << ", Error message: " << strerror(errorCode) << std::endl;
            
            if (errorCode == EINTR) {
                std::cout << "accept() was interrupted by a signal. Retrying...\n";
                continue;
            } else if (errorCode == EMFILE || errorCode == ENFILE) {
                std::cerr << "Too many open files. Consider increasing system limits.\n";
                // You might want to sleep here before retrying or take other corrective action
            } else {
                // For other errors, you might want to break the loop or exit
                std::cerr << "Unrecoverable error in accept(). Exiting.\n";
                return 1;
            }
        }
        log("- done accept");

        if (set_socket_timeout(client_sock, SOCKET_TIMEOUT) != 0) {
            log("Failed to set client socket timeout");
            close(client_sock);
            continue;
        }

        log("Accepted connection from " + std::string(inet_ntoa(client_addr.sin_addr)));
        log("clientSocket: " + std::to_string(client_sock));
        log("clientAddressLength: " + std::to_string(client_len));
        log("clientAddress.sin_family: " + std::to_string(client_addr.sin_family));
        log("clientAddress.sin_addr.s_addr: " + std::to_string(client_addr.sin_addr.s_addr));
        log("clientAddress.sin_port: " + std::to_string(ntohs(client_addr.sin_port)));

        SSL* client_ssl = SSL_new(server_ctx);
        SSL_set_fd(client_ssl, client_sock);

        log("Performing SSL handshake");
        if (SSL_accept(client_ssl) <= 0) {
            log("Failed to perform SSL handshake");
            ERR_print_errors_fp(stderr);
            SSL_free(client_ssl);
            close(client_sock);
            continue;
        }
        log("SSL handshake completed");

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
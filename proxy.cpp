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
#include <cstdlib>
#include <execinfo.h>
#include <signal.h>

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

void catastrophic_failure(const std::string& message) {
    log_time();
    std::cout << message << std::endl;
    perror(message.c_str());
    exit(EXIT_FAILURE);
}

SSL_CTX* create_ssl_context(bool is_server) {
    const SSL_METHOD* method = is_server ? TLS_server_method() : TLS_client_method();
    SSL_CTX* ctx = SSL_CTX_new(method);
    if (!ctx) {
        log_time(); ERR_print_errors_fp(stdout);
        catastrophic_failure("Unable to create SSL context");
    }
    return ctx;
}

void configure_ssl_context(SSL_CTX* ctx, const char* cert_file, const char* key_file) {
    if (SSL_CTX_use_certificate_file(ctx, cert_file, SSL_FILETYPE_PEM) <= 0) {
        log_time(); ERR_print_errors_fp(stdout);
        catastrophic_failure("Failed to load certificate file");
    }
    if (SSL_CTX_use_PrivateKey_file(ctx, key_file, SSL_FILETYPE_PEM) <= 0) {
        log_time(); ERR_print_errors_fp(stdout);
        catastrophic_failure("Failed to load private key file");
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
        log("Failed to create socket");
        if (not is_server) {
            return -1;
        }
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
            catastrophic_failure("Unable to bind");
        }
        if (listen(sock, LISTEN_BACKLOG) < 0) {
            catastrophic_failure("Unable to listen");
        }
    } else {
        // not server
        addr.sin_addr.s_addr = inet_addr(DESTINATION_IP);
        if (connect(sock, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
            log("Failed to connect to destination server");
            close(sock);
            return -1;
        }
        if (set_socket_timeout(sock, SOCKET_TIMEOUT) != 0) {
            close(sock);
            log("Failed to set socket timeout, aborting connection");
            return -1;
        }
    }
    return sock;
}

void handle_client(int client_sock, SSL* client_ssl, SSL_CTX* dest_ctx) {
    log("Handling new client connection");
    int dest_sock = create_socket(DESTINATION_PORT, false);
    if (dest_sock < 0) {
        log("Failed to connect to destination server");
        return;
    }
    SSL* dest_ssl = SSL_new(dest_ctx);
    SSL_set_fd(dest_ssl, dest_sock);

    if (SSL_connect(dest_ssl) <= 0) {
        log_time(); ERR_print_errors_fp(stdout);
        log("Failed to perform SSL handshake with destination server");
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

    // on first client read, steal the first line and print it, it'll contain the http request
    // maybe not the whole thing, but enough to peruse

    bool first_client_read = true;

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
                    int ssl_error = ERR_peek_last_error();
                    if (ssl_error == SSL_ERROR_ZERO_RETURN) {
                        log("Connection closed");
                    } else if (ssl_error == SSL_ERROR_WANT_READ || ssl_error == SSL_ERROR_WANT_WRITE) {
                        log("SSL operation would block, continuing...");
                        continue;
                    } else {
                        log_time(); ERR_print_errors_fp(stdout);
                        log("SSL_read failed with above error");
                    }
                    goto cleanup;
                }
                log(std::to_string(bytes_read) + " received");

                // print out the http request
                if (i == 0 && first_client_read) {
                    std::string first_line(buffer, buffer + bytes_read);
                    if (first_line.find("\r\n") != std::string::npos) {
                        first_line.erase(first_line.find("\r\n"));
                    }
                    log("First line: " + first_line);
                    first_client_read = false;
                }

                log("writing bytes...");
                int bytes_written = SSL_write(write_ssl, buffer, bytes_read);
                if (bytes_written <= 0) {
                    int ssl_error = ERR_peek_last_error();
                    if (ssl_error == SSL_ERROR_WANT_WRITE || ssl_error == SSL_ERROR_WANT_READ) {
                        log("SSL operation would block, continuing...");
                        continue;
                    } else {
                        log_time(); ERR_print_errors_fp(stdout);
                        log("SSL_write failed");
                        goto cleanup;
                    }
                }
                log(std::to_string(bytes_written) + " sent");
            }
        }
    }
    log("Done handling client connection");

cleanup:
    log("Closing connection");
    SSL_shutdown(dest_ssl);
    SSL_free(dest_ssl);
    close(dest_sock);
}

void print_stacktrace() {
    void* array[10];
    size_t size;

    // get void*'s for all entries on the stack
    size = backtrace(array, 10);

    // print out all the frames to stderr
    fprintf(stderr, "Stack trace:\n");
    backtrace_symbols_fd(array, size, STDOUT_FILENO);
}

void exit_handler() {
    print_stacktrace();
}

int main() {
    std::atexit(exit_handler);

    // ignore sigpipe
    struct sigaction sa;
    sa.sa_handler = SIG_IGN;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;

    if (sigaction(SIGPIPE, &sa, NULL) == -1) {
        // Handle error
        perror("sigaction");
        return -1;
    }

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
        if (int ssl_accept_result = SSL_accept(client_ssl); ssl_accept_result <= 0) {
            log_time(); ERR_print_errors_fp(stdout);
            log("SSL_accept failed with above error, returned: " + std::to_string(ssl_accept_result));
            log("Failed to perform SSL handshake");
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

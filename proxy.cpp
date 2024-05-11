#include <iostream>
#include <string>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/select.h>
#include <openssl/ssl.h>
#include <openssl/err.h>

constexpr int proxy_port = 9000;
constexpr int destination_port = 9001;

int main() {
    // Create a socket for the server
    int serverSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (serverSocket == -1) {
        std::cerr << "Failed to create socket" << std::endl;
        return 1;
    }

    // This option will allow bind() to succeed even if a few TIME-WAIT connections are still around.
    // https://handsonnetworkprogramming.com/articles/bind-error-98-eaddrinuse-10048-wsaeaddrinuse-address-already-in-use/#:~:text=It%20means%20the%20operating%20system,if%20you%20restart%20your%20program.&text=This%20option%20will%20allow%20bind,WAIT%20connections%20are%20still%20around.
    int yes = 1;
    if (setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR,
                            (void*)&yes, sizeof(yes)) < 0) {
        perror("setsockopt() failed");
        return 1;
    }

    // Set up the server address
    struct sockaddr_in serverAddress;
    serverAddress.sin_family = AF_INET;
    serverAddress.sin_addr.s_addr = INADDR_ANY;
    serverAddress.sin_port = htons(proxy_port); // Use the proxy_port variable

    // Bind the socket to the server address
    if (bind(serverSocket, (struct sockaddr*)&serverAddress, sizeof(serverAddress)) == -1) {
        std::cerr << "Failed to bind socket" << std::endl;
        perror("bind");
        close(serverSocket);
        return 1;
    }

    // Listen for incoming connections
    int backlog = 1;
    if (listen(serverSocket, backlog) == -1) {
        std::cerr << "Failed to listen for connections" << std::endl;
        close(serverSocket);
        return 1;
    }

    std::cout << "Proxy server is running on port " << proxy_port << std::endl;

    while (true) {
        // Accept a client connection
        struct sockaddr_in clientAddress;
        socklen_t clientAddressLength = sizeof(clientAddress);
        std::cout << "accept\n";
        int clientSocket = accept(serverSocket, (struct sockaddr*)&clientAddress, &clientAddressLength);
        std::cout << "- done accept\n";
        if (clientSocket == -1) {
            std::cerr << "Failed to accept client connection" << std::endl;
            close(serverSocket);
            return 1;
        }

        // Connect to the destination server
        int destinationSocket = socket(AF_INET, SOCK_STREAM, 0);
        if (destinationSocket == -1) {
            std::cerr << "Failed to create socket for destination server" << std::endl;
            close(clientSocket);
            return 1;
        }

        struct sockaddr_in destinationAddress;
        destinationAddress.sin_family = AF_INET;
        destinationAddress.sin_addr.s_addr = inet_addr("127.0.0.1");
        destinationAddress.sin_port = htons(destination_port); // Use the destination_port variable

        if (connect(destinationSocket, (struct sockaddr*)&destinationAddress, sizeof(destinationAddress)) == -1) {
            std::cerr << "Failed to connect to destination server" << std::endl;
            close(clientSocket);
            close(destinationSocket);
            return 1;
        }

        // Initialize SSL
        SSL_library_init();
        SSL_CTX* sslContext = SSL_CTX_new(SSLv23_client_method());
        if (!sslContext) {
            std::cerr << "Failed to create SSL context" << std::endl;
            close(clientSocket);
            close(destinationSocket);
            return 1;
        }

        // Create SSL object and associate it with the destination socket
        SSL* ssl = SSL_new(sslContext);
        if (!ssl) {
            std::cerr << "Failed to create SSL object" << std::endl;
            close(clientSocket);
            close(destinationSocket);
            SSL_CTX_free(sslContext);
            return 1;
        }
        SSL_set_fd(ssl, destinationSocket);

        // Perform SSL handshake
        if (SSL_connect(ssl) != 1) {
            std::cerr << "Failed to perform SSL handshake" << std::endl;
            close(clientSocket);
            close(destinationSocket);
            SSL_free(ssl);
            SSL_CTX_free(sslContext);
            return 1;
        }

        // Proxy the data between the client and destination server
        char buffer[4096];
        while (true) {
            // Set up the file descriptor sets for select
            fd_set readfds;
            FD_ZERO(&readfds);
            FD_SET(clientSocket, &readfds);
            FD_SET(destinationSocket, &readfds);

            // Find the maximum file descriptor value
            int maxfd = std::max(clientSocket, destinationSocket) + 1;

            // Use select to determine which socket is ready for reading
            std::cout << "select\n";
            int ready = select(maxfd, &readfds, nullptr, nullptr, nullptr);
            std::cout << "- done\n";
            if (ready == -1) {
                std::cerr << "Failed to use select" << std::endl;
                close(clientSocket);
                close(destinationSocket);
                return 1;
            }

            // Proxy the data between the client and destination server
            char buffer[4096];
            // Check if the client socket is ready for reading
            if (FD_ISSET(clientSocket, &readfds)) {
                // Read from the client socket
                int bytesRead = read(clientSocket, buffer, sizeof(buffer));
                if (bytesRead <= 0) {
                    break;
                }
                std::cout << "-----------------------------------------\n";
                std::cout << "reading bytes... ";
                std::cout << bytesRead << " received\n";
                std::cout << "request:\n" << std::string_view(buffer, bytesRead) << std::endl;

                std::cout << "writing bytes... ";
                // Encrypt the data using SSL
                int encryptedBytes = SSL_write(ssl, buffer, bytesRead);
                if (encryptedBytes <= 0) {
                    std::cerr << "Failed to encrypt data" << std::endl;
                    break;
                }
                std::cout << encryptedBytes << " sent\n";
            } else {
                std::cout << "client socket not ready\n";
            }

            // Check if the destination socket is ready for reading
            if (FD_ISSET(destinationSocket, &readfds)) {
                // Read from the destination socket
                int encryptedBytes = SSL_read(ssl, buffer, sizeof(buffer));
                if (encryptedBytes <= 0) {
                    break;
                }
                std::cout << "-----------------------------------------\n";
                std::cout << "reading bytes from backend... ";
                std::cout << encryptedBytes << " received\n";
                std::cout << "response:\n" << std::string_view(buffer, encryptedBytes) << std::endl;

                // Decrypt the data using SSL
                int decryptedBytes = write(clientSocket, buffer, encryptedBytes);
                if (decryptedBytes <= 0) {
                    std::cerr << "Failed to decrypt data" << std::endl;
                    break;
                }

                std::cout << "writing bytes to client... ";
                std::cout << decryptedBytes << " sent\n";
            } else {
                std::cout << "destination socket not ready\n";
            }
        }

        // Clean up SSL resources
        SSL_shutdown(ssl);
        SSL_free(ssl);
        SSL_CTX_free(sslContext);

        // Close the sockets
        close(clientSocket);
        close(destinationSocket);
    }

    // Close the server socket
    close(serverSocket);

    return 0;
}
